import { Command } from "commander";
import type { CommandContext } from "../cli.js";
import { createMemoryBranch, createMemoryCommit, createMemoryMerge, recallMemoryCommits } from "../core/runtime.js";

export function registerMemoryCommands(program: Command, context: CommandContext): void {
  const memory = program.command("memory");

  memory
    .command("branch")
    .command("create")
    .requiredOption("--challenge <challengeId>")
    .requiredOption("--name <name>")
    .action(async (options) => {
      context.setCommand("memory branch create");
      const branch = await createMemoryBranch(context.paths, {
        challengeId: options.challenge,
        name: options.name,
        parentBranchId: null
      });

      context.writeSuccess({
        branch
      });
    });

  memory
    .command("commit")
    .command("create")
    .requiredOption("--branch <branchId>")
    .requiredOption("--challenge <challengeId>")
    .requiredOption("--message <message>")
    .requiredOption("--facts <facts>")
    .requiredOption("--hypotheses <hypotheses>")
    .action(async (options) => {
      context.setCommand("memory commit create");
      const commit = await createMemoryCommit(context.paths, {
        branchId: options.branch,
        challengeId: options.challenge,
        message: options.message,
        facts: [options.facts],
        hypotheses: [options.hypotheses],
        artifactIds: [],
        evidenceIds: []
      });

      context.writeSuccess({
        commit
      });
    });

  memory
    .command("merge")
    .requiredOption("--challenge <challengeId>")
    .requiredOption("--source-branch <branchId>")
    .requiredOption("--target-branch <branchId>")
    .requiredOption("--result-commit <commitId>")
    .requiredOption("--summary <summary>")
    .action(async (options) => {
      context.setCommand("memory merge");
      const merge = await createMemoryMerge(context.paths, {
        challengeId: options.challenge,
        sourceBranchId: options.sourceBranch,
        targetBranchId: options.targetBranch,
        resultCommitId: options.resultCommit,
        summary: options.summary
      });

      context.writeSuccess({
        merge
      });
    });

  memory
    .command("recall")
    .requiredOption("--query <query>")
    .option("--challenge <challengeId>")
    .option("--branch <branchId>")
    .option("--status <status>")
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
