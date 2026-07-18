import CommandLine from "./commandline.js";
import type { CommandConfig, CommandExample, HelpCallback } from "./command.js";
import type { OptionConfig } from "./option.js";

export interface CliOption extends OptionConfig {
	name: string;
	description: string;
}

export interface CliCommand extends CommandConfig {
	name: string;
	description: string;
	aliases?: string[];
	usage?: string;
	options?: CliOption[];
	examples?: CommandExample[];
	validate?: (...args: unknown[]) => void | Promise<void>;
	action?: (...args: any[]) => unknown;
	commands?: CliCommand[];
}

export interface CliConfig {
	name: string;
	version?: string;
	description?: string;
	usage?: string;
	options?: CliOption[];
	examples?: CommandExample[];
	commands?: CliCommand[];
	help?: HelpCallback;
}

/** Build a command line from a serializable, declarative command tree. */
export function createCli(config: CliConfig): CommandLine {
	const cli = new CommandLine(config.name);
	cli.usage(config.usage ?? "<command> [options]").help((sections) => {
		if (config.description) sections.splice(1, 0, { body: config.description });
		return config.help?.(sections) ?? sections;
	});
	if (config.version) cli.version(config.version);
	for (const option of config.options ?? [])
		cli.option(option.name, option.description, option);
	for (const example of config.examples ?? []) cli.example(example);

	const register = (definition: CliCommand, parents: string[] = []) => {
		const ownName = definition.name.replace(/[<[].+/, "").trim();
		const prefix = parents.join(" ");
		const rawName = `${prefix}${prefix ? " " : ""}${definition.name}`;
		const command = cli.command(rawName, definition.description, definition);
		for (const alias of definition.aliases ?? [])
			command.alias(`${prefix}${prefix ? " " : ""}${alias}`);
		if (definition.usage) command.usage(definition.usage);
		for (const option of definition.options ?? [])
			command.option(option.name, option.description, option);
		for (const example of definition.examples ?? []) command.example(example);
		if (definition.validate) command.validate(definition.validate);
		if (definition.action) command.action(definition.action);
		for (const child of definition.commands ?? [])
			register(child, [...parents, ownName]);
	};
	for (const command of config.commands ?? []) register(command);
	return cli;
}

export type CompletionShell = "bash" | "fish" | "zsh";

export function generateCompletions(cli: CommandLine, shell: CompletionShell): string {
	const commands = cli.commands.filter((command) => !command.config.hidden && command.name);
	const names = commands.map((command) => command.name).join(" ");
	if (shell === "fish")
		return `${commands.map((command) =>
			`complete -c ${cli.name} -f -a '${command.name}' -d '${command.description.replaceAll("'", "\\'")}'`
		).join("\n")}\ncomplete -c ${cli.name} -f -a '(${cli.name} completion query (commandline -ct) 2>/dev/null)'`;
	if (shell === "zsh")
		return `#compdef ${cli.name}\n_${cli.name}() { local -a values; values=(\${(f)"$(${cli.name} completion query "$words[CURRENT]" 2>/dev/null)"}); _describe 'value' values }\ncompdef _${cli.name} ${cli.name}`;
	return `_${cli.name}_completion() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}"\n  local dynamic="$(${cli.name} completion query "$cur" 2>/dev/null)"\n  COMPREPLY=( $(compgen -W '${names} '"$dynamic" -- "$cur") )\n}\ncomplete -F _${cli.name}_completion ${cli.name}`;
}
