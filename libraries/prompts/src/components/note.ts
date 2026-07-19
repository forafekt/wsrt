import { colors, wrapAnsi } from "@wsrt/ansi-tools";
import { getColumns, settings } from "../core/mod.ts";
import { fastStringWidth as fsw } from "../core/utils/fstring/mod.ts";

import {
	type CommonOptions,
	S_BAR,
	S_BAR_H,
	S_CONNECT_LEFT,
	S_CORNER_BOTTOM_LEFT,
	S_CORNER_BOTTOM_RIGHT,
	S_CORNER_TOP_RIGHT,
	S_STEP_SUBMIT,
} from "./common.ts";

const encoder = new TextEncoder();

type FormatFn = (line: string) => string;
export interface NoteOptions extends CommonOptions {
	format?: FormatFn;
}

const defaultNoteFormatter = (line: string): string => colors.dim(line);

const wrapWithFormat = (message: string, width: number, format: FormatFn): string => {
	const opts = {
		hard: true,
		trim: false,
	};
	const wrapMsg = wrapAnsi(message, width, opts).split("\n");
	const maxWidthNormal = wrapMsg.reduce((sum, ln) => Math.max(fsw(ln), sum), 0);
	const maxWidthFormat = wrapMsg.map(format).reduce((sum, ln) => Math.max(fsw(ln), sum), 0);
	const wrapWidth = width - (maxWidthFormat - maxWidthNormal);
	return wrapAnsi(message, wrapWidth, opts);
};

export const note = (message = "", title = "", opts?: NoteOptions) => {
	const output = opts?.output ?? Deno.stdout;
	const hasGuide = (opts?.withGuide ?? settings.withGuide) !== false;
	const format = opts?.format ?? defaultNoteFormatter;
	const wrapMsg = wrapWithFormat(message, getColumns() - 6, format);
	const lines = ["", ...wrapMsg.split("\n").map(format), ""];
	const titleLen = fsw(title);
	const len =
		Math.max(
			lines.reduce((sum, ln) => {
				const width = fsw(ln);
				return width > sum ? width : sum;
			}, 0),
			titleLen,
		) + 2;
	const msg = lines
		.map((ln) => `${colors.gray(S_BAR)}  ${ln}${" ".repeat(len - fsw(ln))}${colors.gray(S_BAR)}`)
		.join("\n");
	const leadingBorder = hasGuide ? `${colors.gray(S_BAR)}\n` : "";
	const bottomLeft = hasGuide ? S_CONNECT_LEFT : S_CORNER_BOTTOM_LEFT;
	output.writeSync(
		encoder.encode(
			`${leadingBorder}${colors.green(S_STEP_SUBMIT)}  ${colors.reset(title)} ${colors.gray(
				S_BAR_H.repeat(Math.max(len - titleLen - 1, 1)) + S_CORNER_TOP_RIGHT,
			)}\n${msg}\n${colors.gray(bottomLeft + S_BAR_H.repeat(len + 2) + S_CORNER_BOTTOM_RIGHT)}\n`,
		),
	);
};
