import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeRoot, makeRuntimeRoot } from "./helpers.js";
import { runCli } from "../src/cli.js";

const runtimeRoots: string[] = [];

function runtimeEnv(runtimeRoot: string): NodeJS.ProcessEnv {
  return { CTFCTL_RUNTIME_ROOT: runtimeRoot };
}

async function initChallenge(runtimeRoot: string, name: string): Promise<{ id: string }> {
  return JSON.parse(
    (
      await runCli(
        [
          "challenge",
          "init",
          "--name",
          name,
          "--category",
          "reverse",
          "--description",
          "memory cli",
          "--flag-format",
          "flag{...}"
        ],
        runtimeEnv(runtimeRoot)
      )
    ).stdout
  ).data.challenge;
}

async function createBranch(runtimeRoot: string, challengeId: string, name: string): Promise<{ id: string }> {
  return JSON.parse(
    (
      await runCli(["memory", "branch", "create", "--challenge", challengeId, "--name", name], runtimeEnv(runtimeRoot))
    ).stdout
  ).data.branch;
}

async function createCommit(
  runtimeRoot: string,
  input: {
    branchId: string;
    challengeId: string;
    message: string;
    facts?: string;
    hypotheses?: string;
  }
): Promise<{ id: string; branchId: string; challengeId: string; message: string }> {
  return JSON.parse(
    (
      await runCli(
        [
          "memory",
          "commit",
          "create",
          "--branch",
          input.branchId,
          "--challenge",
          input.challengeId,
          "--message",
          input.message,
          "--facts",
          input.facts ?? "shared fact",
          "--hypotheses",
          input.hypotheses ?? "shared hypothesis"
        ],
        runtimeEnv(runtimeRoot)
      )
    ).stdout
  ).data.commit;
}

async function markBranchStatus(
  runtimeRoot: string,
  branchId: string,
  status: "active" | "merged" | "dead"
): Promise<void> {
  const branchPath = join(runtimeRoot, "memory", "branches", `${branchId}.json`);
  const branch = JSON.parse(await readFile(branchPath, "utf8"));
  await writeFile(branchPath, JSON.stringify({ ...branch, status }, null, 2), "utf8");
}

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(cleanupRuntimeRoot));
});

describe("memory commands", () => {
  it("creates a branch, commits to it, and recalls by query", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challengeResult = await runCli(
      [
        "challenge",
        "init",
        "--name",
        "memory challenge",
        "--category",
        "reverse",
        "--description",
        "memory cli",
        "--flag-format",
        "flag{...}"
      ],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    const challenge = JSON.parse(challengeResult.stdout).data.challenge;

    const branchResult = await runCli(
      ["memory", "branch", "create", "--challenge", challenge.id, "--name", "main"],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    expect(branchResult.exitCode).toBe(0);

    const branch = JSON.parse(branchResult.stdout).data.branch;

    const commitResult = await runCli(
      [
        "memory",
        "commit",
        "create",
        "--branch",
        branch.id,
        "--challenge",
        challenge.id,
        "--message",
        "audio spectrogram workflow",
        "--facts",
        "Generate a spectrogram before reversing the binary.",
        "--hypotheses",
        "audio may hide visible text"
      ],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    expect(commitResult.exitCode).toBe(0);

    const recallResult = await runCli(["memory", "recall", "--query", "spectrogram"], {
      CTFCTL_RUNTIME_ROOT: runtimeRoot
    });

    expect(recallResult.exitCode).toBe(0);

    const parsed = JSON.parse(recallResult.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.meta.command).toBe("memory recall");
    expect(parsed.data.matches).toHaveLength(1);
    expect(parsed.data.matches[0].message).toBe("audio spectrogram workflow");
  });

  it("requires every query keyword to match the same memory commit", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const challenge = await initChallenge(runtimeRoot, "multi keyword memory");
    const branch = await createBranch(runtimeRoot, challenge.id, "main");

    await createCommit(runtimeRoot, {
      branchId: branch.id,
      challengeId: challenge.id,
      message: "alpha beta exploit path",
      facts: "spectrogram contains alpha",
      hypotheses: "beta marker is useful"
    });
    await createCommit(runtimeRoot, {
      branchId: branch.id,
      challengeId: challenge.id,
      message: "alpha-only exploit path",
      facts: "spectrogram contains alpha",
      hypotheses: "gamma marker is useful"
    });

    const recallResult = await runCli(["memory", "recall", "--query", "alpha beta"], runtimeEnv(runtimeRoot));

    expect(recallResult.exitCode).toBe(0);
    const matches = JSON.parse(recallResult.stdout).data.matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].message).toBe("alpha beta exploit path");
  });

  it("filters recall results by challenge", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const firstChallenge = await initChallenge(runtimeRoot, "first challenge memory");
    const secondChallenge = await initChallenge(runtimeRoot, "second challenge memory");
    const firstBranch = await createBranch(runtimeRoot, firstChallenge.id, "main");
    const secondBranch = await createBranch(runtimeRoot, secondChallenge.id, "main");

    await createCommit(runtimeRoot, {
      branchId: firstBranch.id,
      challengeId: firstChallenge.id,
      message: "shared beacon in first challenge"
    });
    await createCommit(runtimeRoot, {
      branchId: secondBranch.id,
      challengeId: secondChallenge.id,
      message: "shared beacon in second challenge"
    });

    const recallResult = await runCli(
      ["memory", "recall", "--query", "shared beacon", "--challenge", firstChallenge.id],
      runtimeEnv(runtimeRoot)
    );

    expect(recallResult.exitCode).toBe(0);
    const matches = JSON.parse(recallResult.stdout).data.matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].challengeId).toBe(firstChallenge.id);
    expect(matches[0].message).toBe("shared beacon in first challenge");
  });

  it("filters recall results by branch", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const challenge = await initChallenge(runtimeRoot, "branch filter memory");
    const mainBranch = await createBranch(runtimeRoot, challenge.id, "main");
    const altBranch = await createBranch(runtimeRoot, challenge.id, "alt");

    await createCommit(runtimeRoot, {
      branchId: mainBranch.id,
      challengeId: challenge.id,
      message: "shared branch clue on main"
    });
    await createCommit(runtimeRoot, {
      branchId: altBranch.id,
      challengeId: challenge.id,
      message: "shared branch clue on alt"
    });

    const recallResult = await runCli(
      ["memory", "recall", "--query", "shared branch clue", "--branch", altBranch.id],
      runtimeEnv(runtimeRoot)
    );

    expect(recallResult.exitCode).toBe(0);
    const matches = JSON.parse(recallResult.stdout).data.matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].branchId).toBe(altBranch.id);
    expect(matches[0].message).toBe("shared branch clue on alt");
  });

  it("filters recall results to active branches", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const challenge = await initChallenge(runtimeRoot, "status filter memory");
    const activeBranch = await createBranch(runtimeRoot, challenge.id, "active");
    const mergedBranch = await createBranch(runtimeRoot, challenge.id, "merged");
    const deadBranch = await createBranch(runtimeRoot, challenge.id, "dead");

    await createCommit(runtimeRoot, {
      branchId: activeBranch.id,
      challengeId: challenge.id,
      message: "status beacon on active branch"
    });
    await createCommit(runtimeRoot, {
      branchId: mergedBranch.id,
      challengeId: challenge.id,
      message: "status beacon on merged branch"
    });
    await createCommit(runtimeRoot, {
      branchId: deadBranch.id,
      challengeId: challenge.id,
      message: "status beacon on dead branch"
    });
    await markBranchStatus(runtimeRoot, mergedBranch.id, "merged");
    await markBranchStatus(runtimeRoot, deadBranch.id, "dead");

    const recallResult = await runCli(
      ["memory", "recall", "--query", "status beacon", "--status", "active"],
      runtimeEnv(runtimeRoot)
    );

    expect(recallResult.exitCode).toBe(0);
    const matches = JSON.parse(recallResult.stdout).data.matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].branchId).toBe(activeBranch.id);
    expect(matches[0].message).toBe("status beacon on active branch");
  });


  it("splits comma-separated and repeated commit fields", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const challenge = await initChallenge(runtimeRoot, "list input memory");
    const branch = await createBranch(runtimeRoot, challenge.id, "main");

    const commitResult = await runCli(
      [
        "memory",
        "commit",
        "create",
        "--branch",
        branch.id,
        "--challenge",
        challenge.id,
        "--message",
        "list input commit",
        "--facts",
        "alpha,beta",
        "--facts",
        "gamma",
        "delta, epsilon",
        "--hypotheses",
        "one",
        "two,three",
        "--artifact-ids",
        "art-1,art-2",
        "--evidence-ids",
        "ev-1",
        "ev-2,ev-3"
      ],
      runtimeEnv(runtimeRoot)
    );

    expect(commitResult.exitCode).toBe(0);
    const commit = JSON.parse(commitResult.stdout).data.commit;
    expect(commit.facts).toEqual(["alpha", "beta", "gamma", "delta", "epsilon"]);
    expect(commit.hypotheses).toEqual(["one", "two", "three"]);

    const commitJson = JSON.parse(await readFile(join(runtimeRoot, "memory", "commits", `${commit.id}.json`), "utf8"));
    expect(commitJson.artifactIds).toEqual(["art-1", "art-2"]);
    expect(commitJson.evidenceIds).toEqual(["ev-1", "ev-2", "ev-3"]);
  });

  it("lists, shows, and kills memory branches", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const firstChallenge = await initChallenge(runtimeRoot, "branch management one");
    const secondChallenge = await initChallenge(runtimeRoot, "branch management two");
    const activeBranch = await createBranch(runtimeRoot, firstChallenge.id, "active");
    const deadBranch = await createBranch(runtimeRoot, firstChallenge.id, "dead");
    await createBranch(runtimeRoot, secondChallenge.id, "other");
    const commit = await createCommit(runtimeRoot, {
      branchId: activeBranch.id,
      challengeId: firstChallenge.id,
      message: "branch list commit"
    });

    const killResult = await runCli(["memory", "branch", "kill", "--branch", deadBranch.id], runtimeEnv(runtimeRoot));
    expect(killResult.exitCode).toBe(0);
    expect(JSON.parse(killResult.stdout).data.branch.status).toBe("dead");

    const listResult = await runCli(
      ["memory", "branch", "list", "--challenge", firstChallenge.id, "--status", "active"],
      runtimeEnv(runtimeRoot)
    );
    expect(listResult.exitCode).toBe(0);
    const branches = JSON.parse(listResult.stdout).data.branches;
    expect(branches.map((branch: { id: string }) => branch.id)).toEqual([activeBranch.id]);

    const showResult = await runCli(["memory", "branch", "show", "--branch", activeBranch.id], runtimeEnv(runtimeRoot));
    expect(showResult.exitCode).toBe(0);
    const shown = JSON.parse(showResult.stdout).data;
    expect(shown.branch.id).toBe(activeBranch.id);
    expect(shown.commits.map((shownCommit: { id: string }) => shownCommit.id)).toEqual([commit.id]);
  });

  it("lists memory commits and merges", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const challenge = await initChallenge(runtimeRoot, "list commits and merges");
    const mainBranch = await createBranch(runtimeRoot, challenge.id, "main");
    const altBranch = await createBranch(runtimeRoot, challenge.id, "alt");
    const firstCommit = await createCommit(runtimeRoot, {
      branchId: mainBranch.id,
      challengeId: challenge.id,
      message: "first listed commit"
    });
    const secondCommit = await createCommit(runtimeRoot, {
      branchId: mainBranch.id,
      challengeId: challenge.id,
      message: "second listed commit"
    });

    const commitListResult = await runCli(["memory", "commit", "list", "--branch", mainBranch.id], runtimeEnv(runtimeRoot));
    expect(commitListResult.exitCode).toBe(0);
    expect(JSON.parse(commitListResult.stdout).data.commits.map((commit: { id: string }) => commit.id)).toEqual([
      firstCommit.id,
      secondCommit.id
    ]);

    const mergeResult = await runCli(
      [
        "memory",
        "merge",
        "--challenge",
        challenge.id,
        "--source-branch",
        altBranch.id,
        "--target-branch",
        mainBranch.id,
        "--result-commit",
        secondCommit.id,
        "--summary",
        "listable merge"
      ],
      runtimeEnv(runtimeRoot)
    );
    expect(mergeResult.exitCode).toBe(0);
    const merge = JSON.parse(mergeResult.stdout).data.merge;

    const mergeListResult = await runCli(["memory", "merge", "list", "--challenge", challenge.id], runtimeEnv(runtimeRoot));
    expect(mergeListResult.exitCode).toBe(0);
    expect(JSON.parse(mergeListResult.stdout).data.merges.map((listedMerge: { id: string }) => listedMerge.id)).toEqual([
      merge.id
    ]);
  });

  it("merges two branches through the cli", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);

    const challenge = JSON.parse(
      (
        await runCli(
          [
            "challenge",
            "init",
            "--name",
            "memory challenge",
            "--category",
            "reverse",
            "--description",
            "memory cli",
            "--flag-format",
            "flag{...}"
          ],
          {
            CTFCTL_RUNTIME_ROOT: runtimeRoot
          }
        )
      ).stdout
    ).data.challenge;

    const mainBranch = JSON.parse(
      (
        await runCli(["memory", "branch", "create", "--challenge", challenge.id, "--name", "main"], {
          CTFCTL_RUNTIME_ROOT: runtimeRoot
        })
      ).stdout
    ).data.branch;

    const altBranch = JSON.parse(
      (
        await runCli(["memory", "branch", "create", "--challenge", challenge.id, "--name", "alt"], {
          CTFCTL_RUNTIME_ROOT: runtimeRoot
        })
      ).stdout
    ).data.branch;

    const commit = JSON.parse(
      (
        await runCli(
          [
            "memory",
            "commit",
            "create",
            "--branch",
            mainBranch.id,
            "--challenge",
            challenge.id,
            "--message",
            "validated path",
            "--facts",
            "binary is packed",
            "--hypotheses",
            "upx involved"
          ],
          {
            CTFCTL_RUNTIME_ROOT: runtimeRoot
          }
        )
      ).stdout
    ).data.commit;

    const mergeResult = await runCli(
      [
        "memory",
        "merge",
        "--challenge",
        challenge.id,
        "--source-branch",
        altBranch.id,
        "--target-branch",
        mainBranch.id,
        "--result-commit",
        commit.id,
        "--summary",
        "merge validated path"
      ],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    expect(mergeResult.exitCode).toBe(0);
    const parsed = JSON.parse(mergeResult.stdout);
    expect(parsed.data.merge.targetBranchId).toBe(mainBranch.id);
  });
});
