import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createContainer,
  execInContainer,
  isContainerRunning,
  removeContainer,
  startContainer,
  stopContainer
} from "../src/core/docker.js";

const dockerDaemonAvailable = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonAvailable)("docker primitives", () => {
  let mountDir: string;
  const containerName = `ctfctl-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const missingContainer = `ctfctl-test-missing-${Date.now().toString(36)}`;

  beforeAll(async () => {
    mountDir = await mkdtemp(join(tmpdir(), "ctfctl-docker-"));
    spawnSync("docker", ["pull", "alpine:3.20"], { stdio: "ignore", timeout: 120000 });
  });

  afterAll(async () => {
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore", timeout: 30000 });
    await rm(mountDir, { recursive: true, force: true });
  });

  it("creates a persistent container that runs sleep infinity", async () => {
    const id = await createContainer({
      name: containerName,
      image: "alpine:3.20",
      workdir: "/workspace",
      hostMountPath: mountDir,
      capAdd: ["NET_RAW", "NET_ADMIN"]
    });

    expect(id).toMatch(/^[a-f0-9]+$/);
    expect(id.length).toBeGreaterThan(11);
    expect(await isContainerRunning(containerName)).toBe(true);
  });

  it("execs commands inside the running container", async () => {
    const result = await execInContainer(containerName, "printf hello", 30000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.timeout).toBe(false);
  });

  it("preserves filesystem state between exec calls", async () => {
    const writeResult = await execInContainer(
      containerName,
      "echo persist-data > /tmp/ctfctl-marker",
      30000
    );
    expect(writeResult.exitCode).toBe(0);

    const readResult = await execInContainer(containerName, "cat /tmp/ctfctl-marker", 30000);
    expect(readResult.exitCode).toBe(0);
    expect(readResult.stdout.trim()).toBe("persist-data");
  });

  it("stops, restarts, and reflects running state", async () => {
    await stopContainer(containerName);
    expect(await isContainerRunning(containerName)).toBe(false);

    await startContainer(containerName);
    expect(await isContainerRunning(containerName)).toBe(true);
  });

  it("removeContainer is idempotent for missing containers", async () => {
    await expect(removeContainer(missingContainer)).resolves.toBeUndefined();
  });

  it("isContainerRunning returns false for missing containers", async () => {
    expect(await isContainerRunning(missingContainer)).toBe(false);
  });

  it("execInContainer throws CONTAINER_NOT_FOUND for missing containers", async () => {
    await expect(execInContainer(missingContainer, "echo hi", 5000)).rejects.toMatchObject({
      code: "CONTAINER_NOT_FOUND"
    });
  });

  it("stopContainer surfaces CONTAINER_NOT_FOUND for missing containers", async () => {
    await expect(stopContainer(missingContainer)).rejects.toMatchObject({
      code: "CONTAINER_NOT_FOUND"
    });
  });

  it("removes the container", async () => {
    await removeContainer(containerName);
    expect(await isContainerRunning(containerName)).toBe(false);
  });
});
