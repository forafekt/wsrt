import { colors, wrapTextWithPrefix } from "@wsrt/ansi-tools";
import { MultiSelectController } from "../core/mod.ts";
import {
	type CommonOptions,
	S_BAR,
	S_BAR_END,
	S_CHECKBOX_ACTIVE,
	S_CHECKBOX_INACTIVE,
	S_CHECKBOX_SELECTED,
	symbol,
	symbolBar,
} from "./common.ts";
import { limitOptions } from "./limit-options.ts";
import type { Option } from "./select.ts";

export interface MultiSelectOptions<Value> extends CommonOptions {
	message: string;
	options: Option<Value>[];
	initialValues?: Value[];
	maxItems?: number;
	required?: boolean;
	cursorAt?: Value;
}
const computeLabel = (label: string, format: (text: string) => string) => {
	return label
		.split("\n")
		.map((line) => format(line))
		.join("\n");
};

export const multiselect = <Value>(opts: MultiSelectOptions<Value>) => {
	const opt = (
		option: Option<Value>,
		state:
			| "inactive"
			| "active"
			| "selected"
			| "active-selected"
			| "submitted"
			| "cancelled"
			| "disabled",
	) => {
		const label = option.label ?? String(option.value);
		if (state === "disabled") {
			return `${colors.gray(S_CHECKBOX_INACTIVE)} ${computeLabel(label, (str) =>
				colors.strikethrough(colors.gray(str)),
			)}${option.hint ? ` ${colors.dim(`(${option.hint ?? "disabled"})`)}` : ""}`;
		}
		if (state === "active") {
			return `${colors.cyan(S_CHECKBOX_ACTIVE)} ${label}${
				option.hint ? ` ${colors.dim(`(${option.hint})`)}` : ""
			}`;
		}
		if (state === "selected") {
			return `${colors.green(S_CHECKBOX_SELECTED)} ${computeLabel(
				label,
				colors.dim,
			)}${option.hint ? ` ${colors.dim(`(${option.hint})`)}` : ""}`;
		}
		if (state === "cancelled") {
			return `${computeLabel(label, (text) => colors.strikethrough(colors.dim(text)))}`;
		}
		if (state === "active-selected") {
			return `${colors.green(S_CHECKBOX_SELECTED)} ${label}${
				option.hint ? ` ${colors.dim(`(${option.hint})`)}` : ""
			}`;
		}
		if (state === "submitted") {
			return `${computeLabel(label, colors.dim)}`;
		}
		return `${colors.dim(S_CHECKBOX_INACTIVE)} ${computeLabel(label, colors.dim)}`;
	};
	const required = opts.required ?? true;

	return new MultiSelectController({
		options: opts.options,
		signal: opts.signal,
		input: opts.input,
		output: opts.output,
		initialValues: opts.initialValues,
		required,
		cursorAt: opts.cursorAt,
		validate(selected: Value[] | undefined) {
			if (required && (selected === undefined || selected.length === 0)) {
				return `Please select at least one option.\n${colors.reset(
					colors.dim(
						`Press ${colors.gray(
							colors.bgWhite(colors.inverse(" space ")),
						)} to select, ${colors.gray(colors.bgWhite(colors.inverse(" enter ")))} to submit`,
					),
				)}`;
			}
		},
		render() {
			const wrappedMessage = wrapTextWithPrefix(
				opts.output,
				opts.message,
				`${symbolBar(this.state)}  `,
				`${symbol(this.state)}  `,
			);
			const title = `${colors.gray(S_BAR)}\n${wrappedMessage}\n`;
			const value = this.value ?? [];

			const styleOption = (option: Option<Value>, active: boolean) => {
				if (option.disabled) {
					return opt(option, "disabled");
				}
				const selected = value.includes(option.value);
				if (active && selected) {
					return opt(option, "active-selected");
				}
				if (selected) {
					return opt(option, "selected");
				}
				return opt(option, active ? "active" : "inactive");
			};

			switch (this.state) {
				case "submit": {
					const submitText =
						this.options
							.filter(({ value: optionValue }) => value.includes(optionValue))
							.map((option) => opt(option, "submitted"))
							.join(colors.dim(", ")) || colors.dim("none");
					const wrappedSubmitText = wrapTextWithPrefix(
						opts.output,
						submitText,
						`${colors.gray(S_BAR)}  `,
					);
					return `${title}${wrappedSubmitText}`;
				}
				case "cancel": {
					const label = this.options
						.filter(({ value: optionValue }) => value.includes(optionValue))
						.map((option) => opt(option, "cancelled"))
						.join(colors.dim(", "));
					if (label.trim() === "") {
						return `${title}${colors.gray(S_BAR)}`;
					}
					const wrappedLabel = wrapTextWithPrefix(opts.output, label, `${colors.gray(S_BAR)}  `);
					return `${title}${wrappedLabel}\n${colors.gray(S_BAR)}`;
				}
				case "error": {
					const prefix = `${colors.yellow(S_BAR)}  `;
					const footer = this.error
						.split("\n")
						.map((ln, i) =>
							i === 0 ? `${colors.yellow(S_BAR_END)}  ${colors.yellow(ln)}` : `   ${ln}`,
						)
						.join("\n");
					// Calculate rowPadding: title lines + footer lines (error message + trailing newline)
					const titleLineCount = title.split("\n").length;
					const footerLineCount = footer.split("\n").length + 1; // footer + trailing newline
					return `${title}${prefix}${limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						columnPadding: prefix.length,
						rowPadding: titleLineCount + footerLineCount,
						style: styleOption,
					}).join(`\n${prefix}`)}\n${footer}\n`;
				}
				default: {
					const prefix = `${colors.cyan(S_BAR)}  `;
					// Calculate rowPadding: title lines + footer lines (S_BAR_END + trailing newline)
					const titleLineCount = title.split("\n").length;
					const footerLineCount = 2; // S_BAR_END + trailing newline
					return `${title}${prefix}${limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						columnPadding: prefix.length,
						rowPadding: titleLineCount + footerLineCount,
						style: styleOption,
					}).join(`\n${prefix}`)}\n${colors.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<Value[] | symbol>;
};
