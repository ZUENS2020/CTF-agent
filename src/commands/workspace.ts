import { Command } from "commander";
import type { CommandContext } from "../cli.js";
import { isContainerRunning } from "../core/docker.js";
import {
  createWorkspace,
  destroyWorkspace,
  getWorkspace,
  listWorkspaces,
  startWorkspace,
  stopWorkspace
} from "../core/runtime.js";

export function registerWorkspaceCommands(program: Command, context: CommandContext): void {
  const workspace = program.command("workspace");

  workspace
    .command("create")
    .requiredOption("--challenge <challengeId>")
    .action(async (options) => {
      context.setCommand("workspace create");
      const workspaceRecord = await createWorkspace(context.paths, options.challenge);
      context.writeSuccess({
        workspace: workspaceRecord
      });
    });

  workspace
    .command("destroy")
    .requiredOption("--workspace <workspaceId>")
    .action(async (options) => {
      context.setCommand("workspace destroy");
      const workspaceRecord = await destroyWorkspace(context.paths, options.workspace);
      context.writeSuccess({
        workspace: workspaceRecord
      });
    });

  workspace
    .command("stop")
    .requiredOption("--workspace <workspaceId>")
    .action(async (options) => {
      context.setCommand("workspace stop");
      const workspaceRecord = await stopWorkspace(context.paths, options.workspace);
      context.writeSuccess({
        workspace: workspaceRecord
      });
    });

  workspace
    .command("start")
    .requiredOption("--workspace <workspaceId>")
    .action(async (options) => {
      context.setCommand("workspace start");
      const workspaceRecord = await startWorkspace(context.paths, options.workspace);
      context.writeSuccess({
        workspace: workspaceRecord
      });
    });

  workspace
    .command("status")
    .requiredOption("--workspace <workspaceId>")
    .action(async (options) => {
      context.setCommand("workspace status");
      const workspaceRecord = await getWorkspace(context.paths, options.workspace);
      let running = false;
      if (workspaceRecord.status !== "destroyed") {
        running = await isContainerRunning(workspaceRecord.containerName);
      }
      context.writeSuccess({
        workspace: workspaceRecord,
        running
      });
    });

  workspace.command("list").action(async () => {
    context.setCommand("workspace list");
    const workspaces = await listWorkspaces(context.paths);
    context.writeSuccess({
      workspaces
    });
  });
}
