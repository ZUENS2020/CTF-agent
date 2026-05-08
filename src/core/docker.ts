import { spawn } from "node:child_process";
import { CliError } from "./errors.js";

export interface CreateContainerOptions {
  name: string;
  image: string;
  workdir: string;
  hostMountPath: string;
  capAdd?: string[];
}

export interface DockerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeout: boolean;
}

interface RawResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeout: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

interface RunOptions {
  timeoutMs?: number;
}

const MAX_OUTPUT_LENGTH = 20000;
const HARD_OUTPUT_CAP = 5_000_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  const keep = 8000;
  return `${output.substring(0, keep)}\n...[TRUNCATED ${output.length - 2 * keep} chars]...\n${output.substring(output.length - keep)}`;
}

async function runDockerRaw(args: string[], opts: RunOptions = {}): Promise<RawResult> {
  return await new Promise((resolve) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let isTimeout = false;
    let spawnError: NodeJS.ErrnoException | null = null;
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        isTimeout = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      if (stdout.length < HARD_OUTPUT_CAP) {
        stdout += String(chunk);
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length < HARD_OUTPUT_CAP) {
        stderr += String(chunk);
      }
    });

    child.on("error", (err) => {
      spawnError = err as NodeJS.ErrnoException;
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: -1,
        timeout: isTimeout,
        spawnError
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: isTimeout ? 124 : (code ?? 1),
        timeout: isTimeout,
        spawnError
      });
    });
  });
}

function classifyDockerError(
  stderr: string,
  spawnError: NodeJS.ErrnoException | null
): { code: string; message: string } {
  if (spawnError && spawnError.code === "ENOENT") {
    return {
      code: "DOCKER_DAEMON_UNAVAILABLE",
      message: "Docker CLI not found on PATH"
    };
  }
  const lower = stderr.toLowerCase();
  if (
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("is the docker daemon running")
  ) {
    return {
      code: "DOCKER_DAEMON_UNAVAILABLE",
      message: "Cannot connect to Docker daemon"
    };
  }
  if (lower.includes("no such container") || lower.includes("no such object")) {
    return {
      code: "CONTAINER_NOT_FOUND",
      message: stderr.trim() || "Container not found"
    };
  }
  return {
    code: "DOCKER_OPERATION_FAILED",
    message: stderr.trim() || "Docker operation failed"
  };
}

function throwDockerError(
  stderr: string,
  spawnError: NodeJS.ErrnoException | null,
  fallback: string
): never {
  const { code, message } = classifyDockerError(stderr, spawnError);
  throw new CliError(`${fallback}: ${message}`, code, 1);
}

export async function createContainer(opts: CreateContainerOptions): Promise<string> {
  const args = ["run", "-d", "--name", opts.name];
  for (const cap of opts.capAdd ?? []) {
    args.push("--cap-add", cap);
  }
  args.push("-v", `${opts.hostMountPath}:${opts.workdir}`, "-w", opts.workdir);
  args.push(opts.image, "sleep", "infinity");

  const result = await runDockerRaw(args);
  if (result.exitCode !== 0) {
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to create container ${opts.name}`
    );
  }
  return result.stdout.trim();
}

export async function execInContainer(
  containerName: string,
  cmd: string,
  timeoutMs: number = 60000
): Promise<DockerExecResult> {
  const result = await runDockerRaw(
    ["exec", containerName, "sh", "-lc", cmd],
    { timeoutMs }
  );

  if (result.spawnError) {
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to exec in container ${containerName}`
    );
  }

  if (result.exitCode !== 0 && /no such container/i.test(result.stderr)) {
    throw new CliError(
      `Container not found: ${containerName}`,
      "CONTAINER_NOT_FOUND",
      1
    );
  }

  if (
    result.exitCode !== 0 &&
    /cannot connect to the docker daemon|is the docker daemon running/i.test(result.stderr)
  ) {
    throw new CliError(
      `Cannot connect to Docker daemon while exec'ing in ${containerName}`,
      "DOCKER_DAEMON_UNAVAILABLE",
      1
    );
  }

  return {
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
    exitCode: result.exitCode,
    timeout: result.timeout
  };
}

export async function stopContainer(containerName: string): Promise<void> {
  const result = await runDockerRaw(["stop", containerName]);
  if (result.exitCode !== 0) {
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to stop container ${containerName}`
    );
  }
}

export async function startContainer(containerName: string): Promise<void> {
  const result = await runDockerRaw(["start", containerName]);
  if (result.exitCode !== 0) {
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to start container ${containerName}`
    );
  }
}

export async function removeContainer(containerName: string): Promise<void> {
  const result = await runDockerRaw(["rm", "-f", containerName]);
  if (result.exitCode === 0) {
    return;
  }
  if (/no such container/i.test(result.stderr)) {
    return;
  }
  throwDockerError(
    result.stderr,
    result.spawnError,
    `Failed to remove container ${containerName}`
  );
}

export async function isContainerRunning(containerName: string): Promise<boolean> {
  const result = await runDockerRaw([
    "inspect",
    "-f",
    "{{.State.Running}}",
    containerName
  ]);

  if (result.spawnError) {
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to inspect container ${containerName}`
    );
  }

  if (result.exitCode !== 0) {
    if (/no such (object|container)/i.test(result.stderr)) {
      return false;
    }
    throwDockerError(
      result.stderr,
      result.spawnError,
      `Failed to inspect container ${containerName}`
    );
  }

  return result.stdout.trim() === "true";
}
