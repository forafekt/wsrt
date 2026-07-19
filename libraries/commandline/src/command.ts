// deno-lint-ignore-file no-explicit-any
// command.ts
import type CommandLine from "./commandline.js";
import Option, { type OptionConfig } from "./option.js";
import {
	CommandLineError,
	findAllBrackets,
	findLongest,
	padRight,
	removeBrackets,
} from "./utils.js";
import { platformInfo } from "./deno.js";

interface CommandArg {
	required: boolean;
	value: string;
	variadic: boolean;
}

export interface HelpSection {
	title?: string;
	body: string;
}

interface CommandConfig {
	allowUnknownOptions?: boolean;
	ignoreOptionDefaultValue?: boolean;
	group?: string;
	hidden?: boolean;
}

type HelpCallback = (sections: HelpSection[]) => void | HelpSection[];

type CommandExample = ((bin: string) => string) | string;

class Command {
	options: Option[];
	aliasNames: string[];
	/* Parsed command name */
	name: string;
	args: CommandArg[];
	commandAction?: (...args: any[]) => any;
	usageText?: string;
	versionNumber?: string;
	examples: CommandExample[];
	helpCallback?: HelpCallback;
	globalCommand?: GlobalCommand;
	validators: Array<(...args: any[]) => void | Promise<void>>;

	constructor(
		public rawName: string,
		public description: string,
		public config: CommandConfig = {},
		public cli: CommandLine,
	) {
		this.options = [];
		this.aliasNames = [];
		this.name = removeBrackets(rawName);
		this.args = findAllBrackets(rawName);
		this.examples = [];
		this.validators = [];
	}

	usage(text: string) {
		this.usageText = text;
		return this;
	}

	allowUnknownOptions() {
		this.config.allowUnknownOptions = true;
		return this;
	}

	ignoreOptionDefaultValue() {
		this.config.ignoreOptionDefaultValue = true;
		return this;
	}

	version(version: string, customFlags = "-v, --version") {
		this.versionNumber = version;
		this.option(customFlags, "Display version number");
		return this;
	}

	example(example: CommandExample) {
		this.examples.push(example);
		return this;
	}

	/**
	 * Add a option for this command
	 * @param rawName Raw option name(s)
	 * @param description Option description
	 * @param config Option config
	 */
	option(rawName: string, description: string, config?: OptionConfig) {
		const option = new Option(rawName, description, config);
		this.options.push(option);
		return this;
	}

	alias(name: string) {
		this.aliasNames.push(name);
		return this;
	}

	action(callback: (...args: any[]) => any) {
		this.commandAction = callback;
		return this;
	}

	validate(callback: (...args: any[]) => void | Promise<void>) {
		this.validators.push(callback);
		return this;
	}

	/**
	 * Check if a command name is matched by this command
	 * @param name Command name
	 */
	isMatched(name: string) {
		return this.name === name || this.aliasNames.includes(name);
	}

	get isDefaultCommand() {
		return this.name === "" || this.aliasNames.includes("!");
	}

	get isGlobalCommand(): boolean {
		return this instanceof GlobalCommand;
	}

	/**
	 * Check if an option is registered in this command
	 * @param name Option name
	 */
	hasOption(name: string) {
		name = name.split(".")[0];
		return this.options.find((option) => {
			return option.names.includes(name);
		});
	}

	outputHelp() {
		const { name, commands } = this.cli;
		const { versionNumber, options: globalOptions, helpCallback } = this.cli.globalCommand;

		let sections: HelpSection[] = [
			{
				body: `${name}${versionNumber ? `/${versionNumber}` : ""}`,
			},
		];

		sections.push({
			title: "Usage",
			body: `  $ ${name} ${this.usageText || this.rawName}`.trimEnd(),
		});

		const showCommands = (this.isGlobalCommand || this.isDefaultCommand) && commands.length > 0;

		if (showCommands) {
			const visibleCommands = commands.filter((command) => !command.config.hidden);
			const longestCommandName = findLongest(visibleCommands.map((command) => command.rawName));
			const groups = new Map<string, Command[]>();
			for (const command of visibleCommands) {
				const group = command.config.group ?? "Commands";
				groups.set(group, [...(groups.get(group) ?? []), command]);
			}
			sections.push(
				...[...groups].map(([title, groupedCommands]) => ({
					title,
					body: groupedCommands
						.map((command) => {
							return `  ${padRight(
								command.rawName,
								longestCommandName.length,
							)}  ${command.description}`;
						})
						.join("\n"),
				})),
			);
			sections.push({
				title: `For more info, run any command with the \`--help\` flag`,
				body: visibleCommands
					.map((command) => `  $ ${name}${command.name === "" ? "" : ` ${command.name}`} --help`)
					.join("\n"),
			});
		}

		let options = this.isGlobalCommand
			? globalOptions
			: [...this.options, ...(globalOptions || [])];
		if (!this.isGlobalCommand && !this.isDefaultCommand) {
			options = options.filter((option) => option.name !== "version");
		}
		if (options.length > 0) {
			const longestOptionName = findLongest(options.map((option) => option.rawName));
			sections.push({
				title: "Options",
				body: options
					.map((option) => {
						return `  ${padRight(option.rawName, longestOptionName.length)}  ${option.description}${
							option.config.default === undefined ? "" : ` (default: ${option.config.default})`
						}`.trimEnd();
					})
					.join("\n"),
			});
		}

		if (this.examples.length > 0) {
			sections.push({
				title: "Examples",
				body: this.examples
					.map((example) => {
						if (typeof example === "function") {
							return example(name);
						}
						return example;
					})
					.join("\n"),
			});
		}

		if (helpCallback) {
			sections = helpCallback(sections) || sections;
		}

		console.log(
			sections
				.map((section) => {
					return section.title ? `${section.title}:\n${section.body}` : section.body;
				})
				.join("\n\n"),
		);
	}

	outputVersion() {
		const { name } = this.cli;
		const { versionNumber } = this.cli.globalCommand;
		if (versionNumber) {
			console.log(`${name}/${versionNumber} ${platformInfo}`);
		}
	}

	checkRequiredArgs() {
		const minimalArgsCount = this.args.filter((arg) => arg.required).length;

		if (this.cli.args.length < minimalArgsCount) {
			throw new CommandLineError(`missing required args for command \`${this.rawName}\``);
		}
	}

	checkExtraArgs() {
		const variadic = this.args.some((arg) => arg.variadic);
		if (!variadic && this.cli.args.length > this.args.length) {
			throw new CommandLineError(
				`unexpected argument \`${this.cli.args[this.args.length]}\` for command \`${this.rawName}\``,
			);
		}
	}

	/**
	 * Check if the parsed options contain any unknown options
	 *
	 * Exit and output error when true
	 */
	checkUnknownOptions() {
		const { options, globalCommand } = this.cli;

		if (!this.config.allowUnknownOptions) {
			for (const name of Object.keys(options)) {
				if (name !== "--" && !this.hasOption(name) && !globalCommand.hasOption(name)) {
					throw new CommandLineError(
						`Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``,
					);
				}
			}
		}
	}

	/**
	 * Check if the required string-type options exist
	 */
	checkOptionValue() {
		const { options: parsedOptions, globalCommand } = this.cli;
		const options = [...globalCommand.options, ...this.options];
		for (const option of options) {
			const value = parsedOptions[option.name.split(".")[0]];
			// Check required option value
			if (option.required) {
				const hasNegated = options.some((o) => o.negated && o.names.includes(option.name));
				if (value === true || (value === false && !hasNegated)) {
					throw new CommandLineError(`option \`${option.rawName}\` value is missing`);
				}
			}
		}
	}
}

class GlobalCommand extends Command {
	constructor(cli: CommandLine) {
		super("@@global@@", "", {}, cli);
	}
}

export type { CommandConfig, CommandExample, HelpCallback };

export { GlobalCommand };

export default Command;
