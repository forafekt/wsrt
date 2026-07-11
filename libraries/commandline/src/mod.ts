import CommandLine from "./commandline.ts";
import Command from "./command.ts";
import { CommandLineError } from "./utils.ts";

const cmd = (name: string = "") => new CommandLine(name);

export default cmd;
export { cmd, Command, CommandLine, CommandLineError };
