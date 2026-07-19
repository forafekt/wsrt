import { colors } from "@wsrt/ansi-tools";
import { PasswordController } from "../core/mod.ts";
import { type CommonOptions, S_BAR, S_BAR_END, S_PASSWORD_MASK, symbol } from "./common.ts";

export interface PasswordOptions extends CommonOptions {
	message: string;
	mask?: string;
	validate?: (value: string | undefined) => string | Error | undefined;
	clearOnError?: boolean;
}
export const password = (opts: PasswordOptions) => {
	return new PasswordController({
		validate: opts.validate,
		mask: opts.mask ?? S_PASSWORD_MASK,
		signal: opts.signal,
		input: opts.input,
		output: opts.output,
		render() {
			const title = `${colors.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;
			const userInput = this.userInputWithCursor;
			const masked = this.masked;

			switch (this.state) {
				case "error": {
					const maskedText = masked ? `  ${masked}` : "";
					if (opts.clearOnError) {
						this.clear();
					}
					return `${title.trim()}\n${colors.yellow(S_BAR)}${maskedText}\n${colors.yellow(
						S_BAR_END,
					)}  ${colors.yellow(this.error)}\n`;
				}
				case "submit": {
					const maskedText = masked ? `  ${colors.dim(masked)}` : "";
					return `${title}${colors.gray(S_BAR)}${maskedText}`;
				}
				case "cancel": {
					const maskedText = masked ? `  ${colors.strikethrough(colors.dim(masked))}` : "";
					return `${title}${colors.gray(S_BAR)}${maskedText}${
						masked ? `\n${colors.gray(S_BAR)}` : ""
					}`;
				}
				default:
					return `${title}${colors.cyan(S_BAR)}  ${userInput}\n${colors.cyan(S_BAR_END)}\n`;
			}
		},
	}).prompt() as Promise<string | symbol>;
};
