import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export async function makeRuntimeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ctfctl-"));
}

export async function cleanupRuntimeRoot(runtimeRoot: string): Promise<void> {
  const workspacesDir = join(runtimeRoot, "workspaces");
  try {
    const entries = await readdir(workspacesDir);
    for (const id of entries) {
      spawnSync("docker", ["rm", "-f", `ctfctl-${id}`], {
        stdio: "ignore",
        timeout: 30000
      });
    }
  } catch {
    // workspaces directory may not exist yet
  }
  await rm(runtimeRoot, { recursive: true, force: true });
}

export async function makeTempFile(contents: string, name = "sample.txt"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ctfctl-file-"));
  const filePath = join(dir, name);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}
