import { Command, Option } from "commander";
import type { CommandContext } from "../cli.js";
import { CliError } from "../core/errors.js";
import {
  createMemoryBranch,
  createMemoryCommit,
  createMemoryMerge,
  getMemoryBranch,
  killMemoryBranch,
  listMemoryBranches,
  listMemoryCommitsByBranch,
  listMemoryMerges,
  recallMemoryCommits
} from "../core/runtime.js";

function parseCsvList(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => item.split(",").map((part) => part.trim()).filter(Boolean));
}

export function registerMemoryCommands(program: Command, context: CommandContext): void {
  const memory = program.command("memory");

  const branch = memory.command("branch");
  branch
    .command("create")
    .requiredOption("--challenge <challengeId>")
    .requiredOption("--name <name>")
    .action(async (options) => {
      context.setCommand("memory branch create");
      const createdBranch = await createMemoryBranch(context.paths, {
        challengeId: options.challenge,
        name: options.name,
        parentBranchId: null
      });

      context.writeSuccess({
        branch: createdBranch
      });
    });

  branch
    .command("list")
    .requiredOption("--challenge <challengeId>")
    .addOption(new Option("--status <status>").choices(["active", "merged", "dead"]))
    .action(async (options) => {
      context.setCommand("memory branch list");
      const branches = await listMemoryBranches(context.paths, {
        challengeId: options.challenge,
        status: options.status
      });

      context.writeSuccess({
        branches
      });
    });

  branch
    .command("show")
    .requiredOption("--branch <branchId>")
    .action(async (options) => {
      context.setCommand("memory branch show");
      const shownBranch = await getMemoryBranch(context.paths, options.branch);
      const commits = await listMemoryCommitsByBranch(context.paths, options.branch);

      context.writeSuccess({
        branch: shownBranch,
        commits
      });
    });

  branch
    .command("kill")
    .requiredOption("--branch <branchId>")
    .action(async (options) => {
      context.setCommand("memory branch kill");
      const killedBranch = await killMemoryBranch(context.paths, options.branch);

      context.writeSuccess({
        branch: killedBranch
      });
    });

  const commit = memory.command("commit");
  commit
    .command("create")
    .requiredOption("--branch <branchId>")
    .requiredOption("--challenge <challengeId>")
    .requiredOption("--message <message>")
    .requiredOption("--facts <items...>")
    .requiredOption("--hypotheses <items...>")
    .option("--artifact-ids <items...>")
    .option("--evidence-ids <items...>")
    .action(async (options) => {
      context.setCommand("memory commit create");
      const createdCommit = await createMemoryCommit(context.paths, {
        branchId: options.branch,
        challengeId: options.challenge,
        message: options.message,
        facts: parseCsvList(options.facts),
        hypotheses: parseCsvList(options.hypotheses),
        artifactIds: parseCsvList(options.artifactIds),
        evidenceIds: parseCsvList(options.evidenceIds)
      });

      context.writeSuccess({
        commit: createdCommit
      });
    });

  commit
    .command("list")
    .requiredOption("--branch <branchId>")
    .action(async (options) => {
      context.setCommand("memory commit list");
      const commits = await listMemoryCommitsByBranch(context.paths, options.branch);

      context.writeSuccess({
        commits
      });
    });

  memory
    .command("merge")
    .argument("[action]")
    .option("--challenge <challengeId>")
    .option("--source-branch <branchId>")
    .option("--target-branch <branchId>")
    .option("--result-commit <commitId>")
    .option("--summary <summary>")
    .action(async (action, options) => {
      if (action === "list") {
        context.setCommand("memory merge list");
        if (!options.challenge) {
          throw new CliError("Missing required option --challenge", "MISSING_REQUIRED_OPTION", 1);
        }

        const merges = await listMemoryMerges(context.paths, options.challenge);
        context.writeSuccess({
          merges
        });
        return;
      }

      if (action) {
        throw new CliError(`Unknown memory merge action: ${action}`, "UNKNOWN_MEMORY_MERGE_ACTION", 1);
      }

      const missingOption = [
        ["--challenge", options.challenge],
        ["--source-branch", options.sourceBranch],
        ["--target-branch", options.targetBranch],
        ["--result-commit", options.resultCommit],
        ["--summary", options.summary]
      ].find(([, value]) => !value)?.[0];

      if (missingOption) {
        throw new CliError(`Missing required option ${missingOption}`, "MISSING_REQUIRED_OPTION", 1);
      }

      context.setCommand("memory merge");
      const createdMerge = await createMemoryMerge(context.paths, {
        challengeId: options.challenge,
        sourceBranchId: options.sourceBranch,
        targetBranchId: options.targetBranch,
        resultCommitId: options.resultCommit,
        summary: options.summary
      });

      context.writeSuccess({
        merge: createdMerge
      });
    });

  memory
    .command("recall")
    .requiredOption("--query <query>")
    .option("--challenge <challengeId>")
    .option("--branch <branchId>")
    .addOption(new Option("--status <status>").choices(["active", "merged", "dead"]))
    .action(async (options) => {
      context.setCommand("memory recall");
      const matches = await recallMemoryCommits(context.paths, {
        query: options.query,
        challengeId: options.challenge,
        branchId: options.branch,
        status: options.status
      });
      context.writeSuccess({
        matches
      });
    });
}
