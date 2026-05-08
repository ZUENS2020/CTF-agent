import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeRoot, makeRuntimeRoot } from "./helpers.js";
import { runCli } from "../src/cli.js";

const runtimeRoots: string[] = [];
const dockerDaemonAvailable = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(cleanupRuntimeRoot));
});

async function bootstrapWorkspace(runtimeRoot: string) {
  const challenge = JSON.parse(
    (
      await runCli(
        [
          "challenge",
          "init",
          "--name",
          "local music",
          "--category",
          "reverse",
          "--description",
          "recover the song",
          "--flag-format",
          "flag{...}"
        ],
        {
          CTFCTL_RUNTIME_ROOT: runtimeRoot,
          CTFCTL_DOCKER_IMAGE: "alpine:3.20"
        }
      )
    ).stdout
  ).data.challenge;

  const workspace = JSON.parse(
    (
      await runCli(["workspace", "create", "--challenge", challenge.id], {
        CTFCTL_RUNTIME_ROOT: runtimeRoot,
        CTFCTL_DOCKER_IMAGE: "alpine:3.20"
      })
    ).stdout
  ).data.workspace;

  return { challenge, workspace };
}

describe("exec run", () => {
  it.skipIf(!dockerDaemonAvailable)("runs a command in the docker workspace and returns stdout, stderr, exitCode", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const { workspace } = await bootstrapWorkspace(runtimeRoot);

    const result = await runCli(
      ["exec", "run", "--workspace", workspace.id, "--cmd", "printf hello", "--reason", "smoke test"],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot,
        CTFCTL_DOCKER_IMAGE: "alpine:3.20"
      }
    );

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.command).toBe("exec run");
    expect(parsed.data.backend).toBe("docker");
    expect(parsed.data.command).toBe("printf hello");
    expect(parsed.data.reason).toBe("smoke test");
    expect(parsed.data.stdout).toBe("hello");
    expect(parsed.data.stderr).toBe("");
    expect(parsed.data.exitCode).toBe(0);
  });

  it.skipIf(!dockerDaemonAvailable)("preserves container state across multiple exec runs", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const { workspace } = await bootstrapWorkspace(runtimeRoot);

    const writeResult = await runCli(
      [
        "exec",
        "run",
        "--workspace",
        workspace.id,
        "--cmd",
        "echo persist > /tmp/ctfctl-marker",
        "--reason",
        "write marker"
      ],
      { CTFCTL_RUNTIME_ROOT: runtimeRoot, CTFCTL_DOCKER_IMAGE: "alpine:3.20" }
    );
    expect(writeResult.exitCode).toBe(0);

    const readResult = await runCli(
      [
        "exec",
        "run",
        "--workspace",
        workspace.id,
        "--cmd",
        "cat /tmp/ctfctl-marker",
        "--reason",
        "read marker"
      ],
      { CTFCTL_RUNTIME_ROOT: runtimeRoot, CTFCTL_DOCKER_IMAGE: "alpine:3.20" }
    );

    expect(readResult.exitCode).toBe(0);
    const parsed = JSON.parse(readResult.stdout);
    expect(parsed.data.stdout.trim()).toBe("persist");
  });

  it.skipIf(!dockerDaemonAvailable)("rejects exec when the workspace is stopped", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const { workspace } = await bootstrapWorkspace(runtimeRoot);

    const stopResult = await runCli(["workspace", "stop", "--workspace", workspace.id], {
      CTFCTL_RUNTIME_ROOT: runtimeRoot,
      CTFCTL_DOCKER_IMAGE: "alpine:3.20"
    });
    expect(stopResult.exitCode).toBe(0);

    const execResult = await runCli(
      ["exec", "run", "--workspace", workspace.id, "--cmd", "echo nope", "--reason", "should fail"],
      { CTFCTL_RUNTIME_ROOT: runtimeRoot, CTFCTL_DOCKER_IMAGE: "alpine:3.20" }
    );

    expect(execResult.exitCode).toBe(1);
    const parsed = JSON.parse(execResult.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("WORKSPACE_NOT_READY");
  });

  it.skipIf(!dockerDaemonAvailable)("rejects exec when the workspace is destroyed", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const { workspace } = await bootstrapWorkspace(runtimeRoot);

    const destroyResult = await runCli(["workspace", "destroy", "--workspace", workspace.id], {
      CTFCTL_RUNTIME_ROOT: runtimeRoot,
      CTFCTL_DOCKER_IMAGE: "alpine:3.20"
    });
    expect(destroyResult.exitCode).toBe(0);

    const execResult = await runCli(
      ["exec", "run", "--workspace", workspace.id, "--cmd", "echo nope", "--reason", "should fail"],
      { CTFCTL_RUNTIME_ROOT: runtimeRoot, CTFCTL_DOCKER_IMAGE: "alpine:3.20" }
    );

    expect(execResult.exitCode).toBe(1);
    const parsed = JSON.parse(execResult.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("WORKSPACE_DESTROYED");
  });

  it("returns a structured error when the workspace is missing", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const result = await runCli(
      ["exec", "run", "--workspace", "ws-missing", "--cmd", "printf hello", "--reason", "smoke test"],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot,
        CTFCTL_DOCKER_IMAGE: "alpine:3.20"
      }
    );

    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.meta.command).toBe("exec run");
    expect(parsed.error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(parsed.error.message).toContain("ws-missing");
  });
});
