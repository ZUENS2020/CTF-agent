import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRuntimeRoot, makeRuntimeRoot } from "./helpers.js";
import { runCli } from "../src/cli.js";

const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(cleanupRuntimeRoot));
});

async function createChallengeAndBranch(runtimeRoot: string) {
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

  const branch = JSON.parse(
    (
      await runCli(["memory", "branch", "create", "--challenge", challenge.id, "--name", "main"], {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      })
    ).stdout
  ).data.branch;

  return { challenge, branch };
}

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

  it("splits comma-separated facts and commit reference ids", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const { challenge, branch } = await createChallengeAndBranch(runtimeRoot);

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
        "comma separated commit",
        "--facts",
        "a,b",
        "--hypotheses",
        "h1,h2",
        "--artifact-ids",
        "art-1,art-2",
        "--evidence-ids",
        "ev-1,ev-2"
      ],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    expect(commitResult.exitCode).toBe(0);
    const commit = JSON.parse(commitResult.stdout).data.commit;
    expect(commit.facts).toEqual(["a", "b"]);
    expect(commit.hypotheses).toEqual(["h1", "h2"]);

    const commitJson = JSON.parse(
      await readFile(join(runtimeRoot, "memory", "commits", `${commit.id}.json`), "utf8")
    );
    expect(commitJson.artifactIds).toEqual(["art-1", "art-2"]);
    expect(commitJson.evidenceIds).toEqual(["ev-1", "ev-2"]);
  });

  it("saves repeated and multi-token facts and hypotheses", async () => {
    const runtimeRoot = await makeRuntimeRoot();
    runtimeRoots.push(runtimeRoot);
    const { challenge, branch } = await createChallengeAndBranch(runtimeRoot);

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
        "repeated and variadic commit",
        "--facts",
        "alpha",
        "beta",
        "--facts",
        " gamma, delta ",
        "--hypotheses",
        "one",
        "two",
        "--hypotheses",
        "three,four"
      ],
      {
        CTFCTL_RUNTIME_ROOT: runtimeRoot
      }
    );

    expect(commitResult.exitCode).toBe(0);
    const commit = JSON.parse(commitResult.stdout).data.commit;
    expect(commit.facts).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(commit.hypotheses).toEqual(["one", "two", "three", "four"]);
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
