import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { z, type ZodType } from "zod";
import type { RuntimeConfig } from "./config.js";
import {
  createContainer,
  isContainerRunning,
  removeContainer,
  startContainer,
  stopContainer
} from "./docker.js";
import { CliError } from "./errors.js";
import type {
  ArtifactRecord,
  ChallengeRecord,
  DockerImageRecord,
  EvidenceEntry,
  MemoryBranchRecord,
  MemoryCommitRecord,
  MemoryMergeRecord,
  WorkspaceRecord
} from "./schemas.js";
import {
  artifactSchema,
  challengeSchema,
  dockerImageLedgerSchema,
  evidenceEntrySchema,
  memoryBranchSchema,
  memoryCommitSchema,
  memoryMergeSchema,
  workspaceSchema
} from "./schemas.js";

export interface RuntimePaths {
  root: string;
  challengesDir: string;
  workspacesDir: string;
  artifactsDir: string;
  memoryDir: string;
  memoryBranchesDir: string;
  memoryCommitsDir: string;
  memoryMergesDir: string;
  skillsDir: string;
  skillTracesDir: string;
  skillEvaluationsDir: string;
  skillProposalsDir: string;
  config: RuntimeConfig;
}

export async function ensureRuntime(config: RuntimeConfig): Promise<RuntimePaths> {
  const paths: RuntimePaths = {
    root: config.runtimeRoot,
    challengesDir: join(config.runtimeRoot, "challenges"),
    workspacesDir: join(config.runtimeRoot, "workspaces"),
    artifactsDir: join(config.runtimeRoot, "artifacts"),
    memoryDir: join(config.runtimeRoot, "memory"),
    memoryBranchesDir: join(config.runtimeRoot, "memory", "branches"),
    memoryCommitsDir: join(config.runtimeRoot, "memory", "commits"),
    memoryMergesDir: join(config.runtimeRoot, "memory", "merges"),
    skillsDir: join(config.runtimeRoot, "skills"),
    skillTracesDir: join(config.runtimeRoot, "skill-traces"),
    skillEvaluationsDir: join(config.runtimeRoot, "skill-evaluations"),
    skillProposalsDir: join(config.runtimeRoot, "skill-proposals"),
    config
  };

  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.challengesDir, { recursive: true }),
    mkdir(paths.workspacesDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.memoryDir, { recursive: true }),
    mkdir(paths.memoryBranchesDir, { recursive: true }),
    mkdir(paths.memoryCommitsDir, { recursive: true }),
    mkdir(paths.memoryMergesDir, { recursive: true }),
    mkdir(paths.skillsDir, { recursive: true }),
    mkdir(paths.skillTracesDir, { recursive: true }),
    mkdir(paths.skillEvaluationsDir, { recursive: true }),
    mkdir(paths.skillProposalsDir, { recursive: true })
  ]);

  await reconcileWorkspaces(paths);

  return paths;
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return isErrnoException(error) && error.code === "ENOENT";
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

function validateRecord<T>(schema: ZodType<T>, value: unknown, path: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CliError(
      `Invalid runtime record at ${path}: ${formatSchemaIssues(parsed.error)}`,
      "INVALID_RUNTIME_RECORD",
      1
    );
  }

  return parsed.data;
}

async function readRequiredRecord<T>(
  path: string,
  schema: ZodType<T>,
  notFoundMessage: string,
  notFoundCode: string
): Promise<T> {
  try {
    return await readJsonFile(path, schema);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    if (isMissingFileError(error)) {
      throw new CliError(notFoundMessage, notFoundCode, 1);
    }

    throw error;
  }
}

export async function writeJsonFile<T>(path: string, value: unknown, schema?: ZodType<T>): Promise<void> {
  const validated = schema ? validateRecord(schema, value, path) : value;
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(path: string, schema?: ZodType<T>): Promise<T> {
  const raw = await readFile(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`Invalid runtime record at ${path}: file is not valid JSON`, "INVALID_RUNTIME_RECORD", 1);
  }

  if (!schema) {
    return parsed as T;
  }

  return validateRecord(schema, parsed, path);
}

export async function createChallenge(paths: RuntimePaths, input: Omit<ChallengeRecord, "id" | "createdAt">): Promise<ChallengeRecord> {
  const challenge: ChallengeRecord = {
    id: makeId("ch"),
    createdAt: new Date().toISOString(),
    ...input
  };
  const challengeDir = join(paths.challengesDir, challenge.id);
  await mkdir(challengeDir, { recursive: true });
  await writeJsonFile(join(challengeDir, "challenge.json"), challenge, challengeSchema);
  return challenge;
}

export async function getChallenge(paths: RuntimePaths, challengeId: string): Promise<ChallengeRecord> {
  return await readRequiredRecord(
    join(paths.challengesDir, challengeId, "challenge.json"),
    challengeSchema,
    `Challenge not found: ${challengeId}`,
    "CHALLENGE_NOT_FOUND"
  );
}

export async function createWorkspace(paths: RuntimePaths, challengeId: string): Promise<WorkspaceRecord> {
  await getChallenge(paths, challengeId);
  const workspaceId = makeId("ws");
  const workspaceDir = join(paths.workspacesDir, workspaceId);
  const fsDir = join(workspaceDir, "fs");
  const containerName = `ctfctl-${workspaceId}`;

  await mkdir(workspaceDir, { recursive: true });
  await mkdir(fsDir, { recursive: true });

  const containerId = await createContainer({
    name: containerName,
    image: paths.config.dockerImage,
    workdir: paths.config.dockerWorkdir,
    hostMountPath: fsDir,
    capAdd: ["NET_RAW", "NET_ADMIN"]
  });

  const workspace: WorkspaceRecord = {
    id: workspaceId,
    challengeId,
    backend: "docker",
    status: "ready",
    path: fsDir,
    containerImage: paths.config.dockerImage,
    containerWorkdir: paths.config.dockerWorkdir,
    containerName,
    containerId,
    createdAt: new Date().toISOString(),
    destroyedAt: null
  };

  try {
    await writeJsonFile(join(workspaceDir, "workspace.json"), workspace, workspaceSchema);
  } catch (error) {
    await removeContainer(containerName).catch(() => undefined);
    throw error;
  }
  return workspace;
}

export async function getWorkspace(paths: RuntimePaths, workspaceId: string): Promise<WorkspaceRecord> {
  return await readRequiredRecord(
    join(paths.workspacesDir, workspaceId, "workspace.json"),
    workspaceSchema,
    `Workspace not found: ${workspaceId}`,
    "WORKSPACE_NOT_FOUND"
  );
}

export async function destroyWorkspace(paths: RuntimePaths, workspaceId: string): Promise<WorkspaceRecord> {
  const workspace = await getWorkspace(paths, workspaceId);
  if (workspace.status !== "destroyed") {
    await removeContainer(workspace.containerName);
  }
  const destroyed: WorkspaceRecord = {
    ...workspace,
    status: "destroyed",
    destroyedAt: workspace.destroyedAt ?? new Date().toISOString()
  };
  await writeJsonFile(join(paths.workspacesDir, workspaceId, "workspace.json"), destroyed, workspaceSchema);
  return destroyed;
}

export async function stopWorkspace(paths: RuntimePaths, workspaceId: string): Promise<WorkspaceRecord> {
  const workspace = await getWorkspace(paths, workspaceId);
  if (workspace.status === "destroyed") {
    throw new CliError(`Workspace already destroyed: ${workspaceId}`, "WORKSPACE_DESTROYED", 1);
  }
  if (workspace.status !== "stopped") {
    await stopContainer(workspace.containerName);
  }
  const stopped: WorkspaceRecord = {
    ...workspace,
    status: "stopped"
  };
  await writeJsonFile(join(paths.workspacesDir, workspaceId, "workspace.json"), stopped, workspaceSchema);
  return stopped;
}

export async function startWorkspace(paths: RuntimePaths, workspaceId: string): Promise<WorkspaceRecord> {
  const workspace = await getWorkspace(paths, workspaceId);
  if (workspace.status === "destroyed") {
    throw new CliError(`Workspace already destroyed: ${workspaceId}`, "WORKSPACE_DESTROYED", 1);
  }
  await startContainer(workspace.containerName);
  const started: WorkspaceRecord = {
    ...workspace,
    status: "ready"
  };
  await writeJsonFile(join(paths.workspacesDir, workspaceId, "workspace.json"), started, workspaceSchema);
  return started;
}

export async function listWorkspaces(paths: RuntimePaths): Promise<WorkspaceRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.workspacesDir);
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const workspaces: WorkspaceRecord[] = [];
  for (const id of entries.sort()) {
    const workspacePath = join(paths.workspacesDir, id, "workspace.json");
    try {
      workspaces.push(await readJsonFile<WorkspaceRecord>(workspacePath, workspaceSchema));
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
  }
  return workspaces;
}

export async function reconcileWorkspaces(paths: RuntimePaths): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(paths.workspacesDir);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  for (const id of entries) {
    const workspacePath = join(paths.workspacesDir, id, "workspace.json");
    let workspace: WorkspaceRecord;
    try {
      workspace = await readJsonFile<WorkspaceRecord>(workspacePath, workspaceSchema);
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      if (error instanceof CliError && error.code === "INVALID_RUNTIME_RECORD") {
        continue;
      }
      continue;
    }

    if (workspace.status !== "ready") {
      continue;
    }

    let running: boolean;
    try {
      running = await isContainerRunning(workspace.containerName);
    } catch {
      // Docker may be unavailable on startup. Leave records untouched.
      return;
    }

    if (!running) {
      const stopped: WorkspaceRecord = {
        ...workspace,
        status: "stopped"
      };
      try {
        await writeJsonFile(workspacePath, stopped, workspaceSchema);
      } catch {
        // Best-effort reconciliation; do not fail startup.
      }
    }
  }
}

export async function appendEvidence(paths: RuntimePaths, entry: Omit<EvidenceEntry, "id" | "createdAt">): Promise<EvidenceEntry> {
  await getChallenge(paths, entry.challengeId);
  const stored: EvidenceEntry = {
    id: makeId("ev"),
    createdAt: new Date().toISOString(),
    ...entry
  };
  validateRecord(evidenceEntrySchema, stored, join(paths.challengesDir, entry.challengeId, "evidence.jsonl"));
  await appendFile(
    join(paths.challengesDir, entry.challengeId, "evidence.jsonl"),
    `${JSON.stringify(stored)}\n`,
    "utf8"
  );
  return stored;
}

function getMimeFromFilename(filename: string): string {
  if (filename.endsWith(".txt")) {
    return "text/plain";
  }

  return "application/octet-stream";
}

async function sha256File(filePath: string): Promise<string> {
  const raw = await readFile(filePath);
  return createHash("sha256").update(raw).digest("hex");
}

export async function createArtifact(
  paths: RuntimePaths,
  input: {
    challengeId: string;
    workspaceId: string | null;
    filePath: string;
    source: string;
    derivedFrom: string | null;
  }
): Promise<ArtifactRecord> {
  await getChallenge(paths, input.challengeId);
  const artifactId = makeId("art");
  const artifactDir = join(paths.artifactsDir, artifactId);
  const blobDir = join(artifactDir, "blob");
  const filename = basename(input.filePath);
  const blobPath = join(blobDir, filename);

  await mkdir(blobDir, { recursive: true });
  await copyFile(input.filePath, blobPath);

  const artifact: ArtifactRecord = {
    id: artifactId,
    challengeId: input.challengeId,
    workspaceId: input.workspaceId,
    filename,
    mime: getMimeFromFilename(filename),
    sha256: await sha256File(input.filePath),
    source: input.source,
    derivedFrom: input.derivedFrom,
    blobPath,
    createdAt: new Date().toISOString()
  };

  await writeJsonFile(join(artifactDir, "artifact.json"), artifact, artifactSchema);
  return artifact;
}

export async function listArtifactsByChallenge(paths: RuntimePaths, challengeId: string): Promise<ArtifactRecord[]> {
  const ids = (await readdir(paths.artifactsDir)).sort();
  const artifacts = await Promise.all(
    ids.map(async (artifactId) => {
      const artifactPath = join(paths.artifactsDir, artifactId, "artifact.json");
      try {
        return await readJsonFile<ArtifactRecord>(artifactPath, artifactSchema);
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }

        if (error instanceof CliError) {
          throw error;
        }

        return null;
      }
    })
  );

  return artifacts.filter((artifact): artifact is ArtifactRecord => artifact !== null && artifact.challengeId === challengeId);
}

export async function recallMemoryCommits(
  paths: RuntimePaths,
  query: string
): Promise<MemoryCommitRecord[]> {
  const lowered = query.toLowerCase();
  const files = (await readdir(paths.memoryCommitsDir)).sort();
  const commits = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => readJsonFile<MemoryCommitRecord>(join(paths.memoryCommitsDir, file), memoryCommitSchema))
  );

  return commits.filter((commit) => {
    const haystack = [commit.message, ...commit.facts, ...commit.hypotheses].join(" ").toLowerCase();
    return haystack.includes(lowered);
  });
}

export async function ensureDockerImageRecord(
  paths: RuntimePaths,
  image: string
): Promise<DockerImageRecord> {
  const images = await listDockerImageRecords(paths);
  const record: DockerImageRecord = {
    name: image,
    ensuredAt: new Date().toISOString()
  };
  const existing = images.filter((entry) => entry.name !== image);
  const next = [...existing, record].sort((left, right) => left.name.localeCompare(right.name));
  await writeJsonFile(join(paths.root, "images.json"), next, dockerImageLedgerSchema);
  return record;
}

export async function listDockerImageRecords(
  paths: RuntimePaths
): Promise<DockerImageRecord[]> {
  try {
    return await readJsonFile<DockerImageRecord[]>(join(paths.root, "images.json"), dockerImageLedgerSchema);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    if (isMissingFileError(error)) {
      return [];
    }

    return [];
  }
}

export async function createMemoryBranch(
  paths: RuntimePaths,
  input: {
    challengeId: string;
    name: string;
    parentBranchId: string | null;
  }
): Promise<MemoryBranchRecord> {
  await getChallenge(paths, input.challengeId);
  const branch: MemoryBranchRecord = {
    id: makeId("branch"),
    challengeId: input.challengeId,
    name: input.name,
    status: "active",
    parentBranchId: input.parentBranchId,
    headCommitId: null,
    createdAt: new Date().toISOString()
  };
  await writeJsonFile(join(paths.memoryBranchesDir, `${branch.id}.json`), branch, memoryBranchSchema);
  return branch;
}

async function getMemoryBranch(paths: RuntimePaths, branchId: string): Promise<MemoryBranchRecord> {
  return await readRequiredRecord(
    join(paths.memoryBranchesDir, `${branchId}.json`),
    memoryBranchSchema,
    `Memory branch not found: ${branchId}`,
    "MEMORY_BRANCH_NOT_FOUND"
  );
}

export async function createMemoryCommit(
  paths: RuntimePaths,
  input: {
    branchId: string;
    challengeId: string;
    message: string;
    facts: string[];
    hypotheses: string[];
    artifactIds: string[];
    evidenceIds: string[];
  }
): Promise<MemoryCommitRecord> {
  const branch = await getMemoryBranch(paths, input.branchId);
  const commit: MemoryCommitRecord = {
    id: makeId("commit"),
    branchId: input.branchId,
    challengeId: input.challengeId,
    parentCommitId: branch.headCommitId,
    message: input.message,
    facts: input.facts,
    hypotheses: input.hypotheses,
    artifactIds: input.artifactIds,
    evidenceIds: input.evidenceIds,
    createdAt: new Date().toISOString()
  };

  await writeJsonFile(join(paths.memoryCommitsDir, `${commit.id}.json`), commit, memoryCommitSchema);
  await writeJsonFile(join(paths.memoryBranchesDir, `${branch.id}.json`), {
    ...branch,
    headCommitId: commit.id
  } satisfies MemoryBranchRecord, memoryBranchSchema);
  return commit;
}

export async function createMemoryMerge(
  paths: RuntimePaths,
  input: {
    challengeId: string;
    sourceBranchId: string;
    targetBranchId: string;
    resultCommitId: string;
    summary: string;
  }
): Promise<MemoryMergeRecord> {
  const sourceBranch = await getMemoryBranch(paths, input.sourceBranchId);
  const targetBranch = await getMemoryBranch(paths, input.targetBranchId);

  const merge: MemoryMergeRecord = {
    id: makeId("merge"),
    challengeId: input.challengeId,
    sourceBranchId: input.sourceBranchId,
    targetBranchId: input.targetBranchId,
    resultCommitId: input.resultCommitId,
    summary: input.summary,
    createdAt: new Date().toISOString()
  };

  await writeJsonFile(join(paths.memoryMergesDir, `${merge.id}.json`), merge, memoryMergeSchema);
  await writeJsonFile(join(paths.memoryBranchesDir, `${sourceBranch.id}.json`), {
    ...sourceBranch,
    status: "merged"
  } satisfies MemoryBranchRecord, memoryBranchSchema);
  await writeJsonFile(join(paths.memoryBranchesDir, `${targetBranch.id}.json`), targetBranch, memoryBranchSchema);
  return merge;
}
