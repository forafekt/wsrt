
// commandline.ts
import ap from "@wsrt/argparse";
import { EventEmitter } from "@wsrt/event-targets";
import Command, {
	type CommandConfig,
	type CommandExample,
	GlobalCommand,
	type HelpCallback,
} from "./command.js";
import { processArgs } from "./deno.js";
import type { OptionConfig } from "./option.js";
import {
	camelcaseOptionName,
	CommandLineError,
	editDistance,
	getArgParseOptions,
	getFileName,
	setByType,
	setDotProp,
} from "./utils.js";

interface ParsedArgv {
	args: ReadonlyArray<string>;
	options: {
		[k: string]: any;
	};
}

class CommandLine extends EventEmitter {
	/** The program name to display in help and version message */
	name: string;
	commands: Command[];
	globalCommand: GlobalCommand;
	matchedCommand?: Command;
	matchedCommandName?: string;
	/**
	 * Raw CLI arguments
	 */
	rawArgs: string[];
	/**
	 * Parsed CLI arguments
	 */
	args: ParsedArgv["args"];
	/**
	 * Parsed CLI options, camelCased
	 */
	options: ParsedArgv["options"];

	showHelpOnExit?: boolean;
	showVersionOnExit?: boolean;

	/**
	 * @param name The program name to display in help and version message
	 */
	constructor(name = "") {
		super();
		this.name = name;
		this.commands = [];
		this.rawArgs = [];
		this.args = [];
		this.options = {};
		this.globalCommand = new GlobalCommand(this);
		this.globalCommand.usage("<command> [options]");
	}

	/**
	 * Add a global usage text.
	 *
	 * This is not used by sub-commands.
	 */
	usage(text: string) {
		this.globalCommand.usage(text);
		return this;
	}

	/**
	 * Add a sub-command
	 */
	command(rawName: string, description?: string, config?: CommandConfig) {
		const command = new Command(rawName, description || "", config, this);
		command.globalCommand = this.globalCommand;
		this.commands.push(command);
		return command;
	}

	/**
	 * Add a global CLI option.
	 *
	 * Which is also applied to sub-commands.
	 */
	option(rawName: string, description: string, config?: OptionConfig) {
		this.globalCommand.option(rawName, description, config);
		return this;
	}

	/**
	 * Show help message when `-h, --help` flags appear.
	 */
	help(callback?: HelpCallback) {
		this.globalCommand.option("-h, --help", "Display this message");
		this.globalCommand.helpCallback = callback;
		this.showHelpOnExit = true;
		return this;
	}

	/**
	 * Show version number when `-v, --version` flags appear.
	 */
	version(version: string, customFlags = "-v, --version") {
		this.globalCommand.version(version, customFlags);
		this.showVersionOnExit = true;
		return this;
	}

	/**
	 * Add a global example.
	 *
	 * This example added here will not be used by sub-commands.
	 */
	example(example: CommandExample) {
		this.globalCommand.example(example);
		return this;
	}

	/**
	 * Output the corresponding help message
	 * When a sub-command is matched, output the help message for the command
	 * Otherwise output the global one.
	 */
	outputHelp() {
		if (this.matchedCommand && !this.matchedCommand.isDefaultCommand) {
			this.matchedCommand.outputHelp();
		} else {
			this.globalCommand.outputHelp();
		}
	}

	/**
	 * Output the version number.
	 */
	outputVersion() {
		this.globalCommand.outputVersion();
	}

	private setParsedInfo(
		{ args, options }: ParsedArgv,
		matchedCommand?: Command,
		matchedCommandName?: string,
	) {
		this.args = args;
		this.options = options;
		if (matchedCommand) {
			this.matchedCommand = matchedCommand;
		}
		if (matchedCommandName) {
			this.matchedCommandName = matchedCommandName;
		}
		return this;
	}

	unsetMatchedCommand() {
		this.matchedCommand = undefined;
		this.matchedCommandName = undefined;
	}

	/**
	 * Parse argv
	 */
	parse(
		argv = processArgs,
		{
			/** Whether to run the action for matched command */
			run = true,
		} = {},
	): ParsedArgv {
		this.rawArgs = argv;
		if (!this.name) {
			this.name = argv[1] ? getFileName(argv[1]) : "cli";
		}

		let shouldParse = true;

		// Search longest command path first so `plugin list` wins over `plugin`.
		const commands = [...this.commands].sort(
			(left, right) => right.name.split(/\s+/).length - left.name.split(/\s+/).length,
		);
		for (const command of commands) {
			if (command.isDefaultCommand) continue;
			const parsed = this.argparse(argv.slice(2), command);
			const commandNames = [command.name, ...command.aliasNames];
			const matchedName = commandNames.find((name) => {
				const parts = name.split(/\s+/).filter(Boolean);
				return parts.every((part, index) => parsed.args[index] === part);
			});
			if (matchedName !== undefined) {
				shouldParse = false;
				const depth = matchedName.split(/\s+/).filter(Boolean).length;
				const parsedInfo = {
					...parsed,
					args: parsed.args.slice(depth),
				};
				this.setParsedInfo(parsedInfo, command, matchedName);
				this.emit(`command:${matchedName}`, command);
				break;
			}
		}

		if (shouldParse) {
			// Search the default command
			for (const command of this.commands) {
				if (command.name === "") {
					const parsed = this.argparse(argv.slice(2), command);
					const acceptsExtra = command.args.some((arg) => arg.variadic);
					if (!acceptsExtra && parsed.args.length > command.args.length) continue;
					shouldParse = false;
					this.setParsedInfo(parsed, command);
					this.emit(`command:!`, command);
				}
			}
		}

		if (shouldParse) {
			const parsed = this.argparse(argv.slice(2));
			this.setParsedInfo(parsed);
		}

		if (this.options.help && this.showHelpOnExit) {
			this.outputHelp();
			run = false;
			this.unsetMatchedCommand();
		}

		if (this.options.version && this.showVersionOnExit && this.matchedCommandName == null) {
			this.outputVersion();
			run = false;
			this.unsetMatchedCommand();
		}

		const parsedArgv = { args: this.args, options: this.options };

		if (run) {
			this.runMatchedCommand();
		}

		if (!this.matchedCommand && this.args[0]) {
			this.emit("command:*", undefined);
		}

		return parsedArgv;
	}

	/** Parse argv and await validation and the selected command action. */
	async parseAsync(argv = processArgs, { run = true } = {}): Promise<ParsedArgv> {
		const parsed = this.parse(argv, { run: false });
		if (run && this.matchedCommand) await this.runMatchedCommand();
		if (!this.matchedCommand && this.args[0] && !this.options.help && !this.options.version) {
			throw this.unknownCommandError(String(this.args[0]));
		}
		return parsed;
	}

	private unknownCommandError(input: string) {
		const names = this.commands
			.filter((command) => !command.config.hidden && command.name)
			.map((command) => command.name.split(/\s+/)[0]);
		const suggestion = [...new Set(names)]
			.map((name) => ({ name, distance: editDistance(input, name) }))
			.sort((left, right) => left.distance - right.distance)[0];
		const hint =
			suggestion && suggestion.distance <= Math.max(2, Math.floor(input.length / 2))
				? ` Did you mean \`${suggestion.name}\`?`
				: " Run with `--help` to see available commands.";
		return new CommandLineError(`unknown command \`${input}\`.${hint}`);
	}

	private argparse(argv: string[], /** Matched command */ command?: Command): ParsedArgv {
		// All added options
		const cliOptions = [...this.globalCommand.options, ...(command ? command.options : [])];
		const argparseOptions = getArgParseOptions(cliOptions);

		// Extract everything after `--` since argparse doesn't support it
		let argsAfterDoubleDashes: string[] = [];
		const doubleDashesIndex = argv.indexOf("--");
		if (doubleDashesIndex > -1) {
			argsAfterDoubleDashes = argv.slice(doubleDashesIndex + 1);
			argv = argv.slice(0, doubleDashesIndex);
		}

		let parsed = ap(argv, argparseOptions);
		parsed = Object.keys(parsed).reduce(
			(res, name) => {
				//Avoid the use of spread (`...`) syntax on accumulators.biomelint/performance/noAccumulatingSpread
				// return {
				// 	...res,
				// 	[camelcaseOptionName(name)]: parsed[name],
				// };
				res[camelcaseOptionName(name)] = parsed[name];
				return res;
			},
			{ _: [] },
		);

		const args = parsed._ as ReadonlyArray<string>;

		const options: { [k: string]: any } = {
			"--": argsAfterDoubleDashes,
		};

		// Set option default value
		const ignoreDefault = command?.config.ignoreOptionDefaultValue
			? command.config.ignoreOptionDefaultValue
			: this.globalCommand.config.ignoreOptionDefaultValue;

		const transforms = Object.create(null);

		for (const cliOption of cliOptions) {
			if (!ignoreDefault && cliOption.config.default !== undefined) {
				for (const name of cliOption.names) {
					options[name] = cliOption.config.default;
				}
			}

			// If options type is defined
			if (Array.isArray(cliOption.config.type)) {
				if (transforms[cliOption.name] === undefined) {
					transforms[cliOption.name] = Object.create(null);

					transforms[cliOption.name].shouldTransform = true;
					transforms[cliOption.name].transformFunction = cliOption.config.type[0];
				}
			}
		}

		// Set option values (support dot-nested property name)
		for (const key of Object.keys(parsed)) {
			if (key !== "_") {
				const keys = key.split(".");
				setDotProp(options, keys, parsed[key]);
				setByType(options, transforms);
			}
		}

		return {
			args,
			options,
		};
	}

	runMatchedCommand() {
		const { args, options, matchedCommand: command } = this;

		if (!command?.commandAction) return;

		command.checkUnknownOptions();

		command.checkOptionValue();

		command.checkRequiredArgs();

		command.checkExtraArgs();

		const actionArgs: any[] = [];
		command.args.forEach((arg, index) => {
			if (arg.variadic) {
				actionArgs.push(args.slice(index));
			} else {
				actionArgs.push(args[index]);
			}
		});
		actionArgs.push(options);
		let pending: Promise<unknown> | undefined;
		for (const validator of command.validators) {
			if (pending) {
				pending = pending.then(() => validator.apply(this, actionArgs));
			} else {
				const result = validator.apply(this, actionArgs);
				if (result && typeof (result as Promise<unknown>).then === "function") {
					pending = result as Promise<unknown>;
				}
			}
		}
		return pending
			? pending.then(() => command.commandAction?.apply(this, actionArgs))
			: command.commandAction.apply(this, actionArgs);
	}
}

export default CommandLine;
