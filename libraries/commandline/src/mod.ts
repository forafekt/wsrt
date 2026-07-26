import Command from "./command.js";
import CommandLine from "./commandline.js";
import { CommandLineError } from "./utils.js";

const cmd = (name: string = "") => new CommandLine(name);

export default cmd;

export type {
	CliCommand,
	CliConfig,
	CliOption,
	CompletionShell,
} from "./create.js";

export { createCli, generateCompletions } from "./create.js";
export { Command, CommandLine, CommandLineError, cmd };
