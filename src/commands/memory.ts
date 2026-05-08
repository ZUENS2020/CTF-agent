import { Command } from "commander";
import type { CommandContext } from "../cli.js";
import { createMemoryBranch, createMemoryCommit, createMemoryMerge, recallMemoryCommits } from "../core/runtime.js";

function parseCsvList(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => item.split(",").map((part) => part.trim()).filter(Boolean));
}

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
    .requiredOption("--facts <items...>")
    .requiredOption("--hypotheses <items...>")
    .option("--artifact-ids <items...>")
    .option("--evidence-ids <items...>")
    .action(async (options) => {
      context.setCommand("memory commit create");
      const commit = await createMemoryCommit(context.paths, {
        branchId: options.branch,
        challengeId: options.challenge,
        message: options.message,
        facts: parseCsvList(options.facts),
        hypotheses: parseCsvList(options.hypotheses),
        artifactIds: parseCsvList(options.artifactIds),
        evidenceIds: parseCsvList(options.evidenceIds)
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

  memory.command("recall").requiredOption("--query <query>").action(async (options) => {
      context.setCommand("memory recall");
      const matches = await recallMemoryCommits(context.paths, options.query);
      context.writeSuccess({
        matches
      });
    });
}
