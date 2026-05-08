import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeRoot, makeRuntimeRoot } from "./helpers.js";
import { runCli } from "../src/cli.js";

const runtimeRoots: string[] = [];
const dockerDaemonAvailable = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(cleanupRuntimeRoot));
});

const env = (runtimeRoot: string) => ({
  CTFCTL_RUNTIME_ROOT: runtimeRoot,
  CTFCTL_DOCKER_IMAGE: "alpine:3.20"
});

async function initChallenge(runtimeRoot: string, name = "ws challenge") {
  const result = await runCli(
    [
      "challenge",
      "init",
      "--name",
      name,
      "--category",
      "reverse",
      "--description",
      "ws test",
      "--flag-format",
      "flag{...}"
    ],
    env(runtimeRoot)
  );
  return JSON.parse(result.stdout).data.challenge;
}

async function createWs(runtimeRoot: string, challengeId: string) {
  const result = await runCli(["workspace", "create", "--challenge", challengeId], env(runtimeRoot));
  return JSON.parse(result.stdout).data.workspace;
}

describe.skipIf(!dockerDaemonAvailable)("workspace lifecycle", () => {
  it("creates a docker workspace and returns JSON with workspace path", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "local music");
    const result = await runCli(["workspace", "create", "--challenge", challenge.id], env(runtimeRoot));

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.command).toBe("workspace create");
    expect(parsed.data.workspace.id).toMatch(/^ws-/);
    expect(parsed.data.workspace.challengeId).toBe(challenge.id);
    expect(parsed.data.workspace.path).toContain(parsed.data.workspace.id);
    expect(parsed.data.workspace.backend).toBe("docker");
    expect(parsed.data.workspace.status).toBe("ready");
    expect(parsed.data.workspace.containerImage).toBe("alpine:3.20");
    expect(parsed.data.workspace.containerWorkdir).toBe("/workspace");
    expect(parsed.data.workspace.containerName).toMatch(/^ctfctl-ws-/);
    expect(parsed.data.workspace.containerId).toMatch(/^[a-f0-9]{12,}$/);
    expect(parsed.data.workspace.destroyedAt).toBeNull();
  });

  it("destroys a workspace through the cli and stamps destroyedAt", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "destroy challenge");
    const workspace = await createWs(runtimeRoot, challenge.id);

    const destroyResult = await runCli(["workspace", "destroy", "--workspace", workspace.id], env(runtimeRoot));

    expect(destroyResult.exitCode).toBe(0);
    const destroyed = JSON.parse(destroyResult.stdout).data.workspace;
    expect(destroyed.status).toBe("destroyed");
    expect(destroyed.destroyedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("stops a running workspace and reflects status=stopped", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "stop challenge");
    const workspace = await createWs(runtimeRoot, challenge.id);

    const stopResult = await runCli(["workspace", "stop", "--workspace", workspace.id], env(runtimeRoot));

    expect(stopResult.exitCode).toBe(0);
    expect(JSON.parse(stopResult.stdout).data.workspace.status).toBe("stopped");
  });

  it("starts a stopped workspace and reflects status=ready", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "start challenge");
    const workspace = await createWs(runtimeRoot, challenge.id);

    await runCli(["workspace", "stop", "--workspace", workspace.id], env(runtimeRoot));
    const startResult = await runCli(["workspace", "start", "--workspace", workspace.id], env(runtimeRoot));

    expect(startResult.exitCode).toBe(0);
    expect(JSON.parse(startResult.stdout).data.workspace.status).toBe("ready");
  });

  it("reports container running status via workspace status", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "status challenge");
    const workspace = await createWs(runtimeRoot, challenge.id);

    const statusResult = await runCli(["workspace", "status", "--workspace", workspace.id], env(runtimeRoot));
    expect(statusResult.exitCode).toBe(0);
    const parsed = JSON.parse(statusResult.stdout).data;
    expect(parsed.workspace.id).toBe(workspace.id);
    expect(parsed.running).toBe(true);

    await runCli(["workspace", "stop", "--workspace", workspace.id], env(runtimeRoot));
    const stoppedStatus = await runCli(["workspace", "status", "--workspace", workspace.id], env(runtimeRoot));
    expect(JSON.parse(stoppedStatus.stdout).data.running).toBe(false);
  });

  it("lists all known workspaces", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = await initChallenge(runtimeRoot, "list challenge");
    const workspaceA = await createWs(runtimeRoot, challenge.id);
    const workspaceB = await createWs(runtimeRoot, challenge.id);

    const listResult = await runCli(["workspace", "list"], env(runtimeRoot));
    expect(listResult.exitCode).toBe(0);
    const ids = JSON.parse(listResult.stdout).data.workspaces.map((w: { id: string }) => w.id);
    expect(ids).toContain(workspaceA.id);
    expect(ids).toContain(workspaceB.id);
  });
});

describe("workspace list", () => {
  it("returns an empty array when no workspaces exist", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const result = await runCli(["workspace", "list"], env(runtimeRoot));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data.workspaces).toEqual([]);
  });
});
