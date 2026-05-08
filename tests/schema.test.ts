import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeRoot, makeRuntimeRoot } from "./helpers.js";
import { resolveConfig } from "../src/core/config.js";
import {
  ensureRuntime,
  getWorkspace,
  listDockerImageRecords,
  writeJsonFile
} from "../src/core/runtime.js";

const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(cleanupRuntimeRoot));
});

describe("runtime schema validation", () => {
  it("rejects malformed workspace records", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const paths = await ensureRuntime(await resolveConfig({ CTFCTL_RUNTIME_ROOT: runtimeRoot }));

    const workspaceId = "ws-schema-test";
    const workspaceDir = join(paths.workspacesDir, workspaceId);
    await mkdir(workspaceDir, { recursive: true });

    await writeJsonFile(join(workspaceDir, "workspace.json"), {
      id: workspaceId,
      challengeId: "ch-test",
      backend: "local-shell",
      status: "ready",
      path: workspaceDir,
      containerImage: "alpine:3.20",
      containerWorkdir: "/workspace",
      containerName: `ctfctl-${workspaceId}`,
      containerId: null,
      createdAt: new Date().toISOString(),
      destroyedAt: null
    });

    await expect(getWorkspace(paths, workspaceId)).rejects.toMatchObject({
      code: "INVALID_RUNTIME_RECORD"
    });
  });

  it("accepts workspace records that lack containerId and destroyedAt for backward compatibility", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const paths = await ensureRuntime(await resolveConfig({ CTFCTL_RUNTIME_ROOT: runtimeRoot }));

    const workspaceId = "ws-legacy";
    const workspaceDir = join(paths.workspacesDir, workspaceId);
    await mkdir(workspaceDir, { recursive: true });

    await writeJsonFile(join(workspaceDir, "workspace.json"), {
      id: workspaceId,
      challengeId: "ch-test",
      backend: "docker",
      status: "ready",
      path: workspaceDir,
      containerImage: "alpine:3.20",
      containerWorkdir: "/workspace",
      containerName: `ctfctl-${workspaceId}`,
      createdAt: new Date().toISOString()
    });

    const workspace = await getWorkspace(paths, workspaceId);
    expect(workspace.containerId).toBeNull();
    expect(workspace.destroyedAt).toBeNull();
  });

  it("rejects malformed docker image ledgers", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const paths = await ensureRuntime(await resolveConfig({ CTFCTL_RUNTIME_ROOT: runtimeRoot }));

    await writeJsonFile(join(paths.root, "images.json"), [
      {
        name: 123,
        ensuredAt: "not-a-date"
      }
    ]);

    await expect(listDockerImageRecords(paths)).rejects.toMatchObject({
      code: "INVALID_RUNTIME_RECORD"
    });
  });
});
