import CommandLine from "./commandline.js";
import Command from "./command.js";
import { CommandLineError } from "./utils.js";

const cmd = (name: string = "") => new CommandLine(name);

export default cmd;
export { cmd, Command, CommandLine, CommandLineError };
export { createCli, generateCompletions } from "./create.js";
export type {
	CliCommand,
	CliConfig,
	CliOption,
	CompletionShell,
} from "./create.js";
