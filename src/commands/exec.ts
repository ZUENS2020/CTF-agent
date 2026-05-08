import { Command } from "commander";
import type { CommandContext } from "../cli.js";
import { execInContainer } from "../core/docker.js";
import { CliError } from "../core/errors.js";
import { getWorkspace } from "../core/runtime.js";

export function registerExecCommands(program: Command, context: CommandContext): void {
  const execCommand = program.command("exec");

  execCommand
    .command("run")
    .requiredOption("--workspace <workspaceId>")
    .requiredOption("--cmd <command>")
    .requiredOption("--reason <reason>")
    .option("-t, --timeout <ms>", "timeout in ms (set to 0 to disable)", "60000")
    .action(async (options) => {
      context.setCommand("exec run");
      const workspace = await getWorkspace(context.paths, options.workspace);

      if (workspace.status !== "ready") {
        if (workspace.status === "destroyed") {
          throw new CliError(
            `Workspace destroyed: ${workspace.id}`,
            "WORKSPACE_DESTROYED",
            1
          );
        }
        throw new CliError(
          `Workspace not ready (status=${workspace.status}): ${workspace.id}`,
          "WORKSPACE_NOT_READY",
          1
        );
      }

      const timeoutMs = parseInt(options.timeout, 10);
      const result = await execInContainer(workspace.containerName, options.cmd, timeoutMs);

      context.writeSuccess({
        backend: workspace.backend,
        image: workspace.containerImage,
        workspaceId: workspace.id,
        command: options.cmd,
        reason: options.reason,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timeout: result.timeout
      });
    });
}
