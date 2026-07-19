import { cursor, erase, wrapAnsi } from "@wsrt/ansi-tools";

import type { BootPromptEvents, BootPromptState } from "../types.ts";
import {
	CANCEL_SYMBOL,
	createKeyDecoder,
	isActionKey,
	setRawMode,
	settings,
} from "../utils/mod.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PromptOptions<TValue, Self extends Prompt<TValue>> {
	render(this: Omit<Self, "prompt">): string | undefined;
	initialValue?: any;
	initialUserInput?: string;
	validate?: (value: TValue | undefined) => string | Error | undefined;
	debug?: boolean;
	signal?: AbortSignal;
	input?: typeof Deno.stdin;
	output?: typeof Deno.stdout;
}

export default class Prompt<TValue> {
	protected input: typeof Deno.stdin;
	protected output: typeof Deno.stdout;

	private _abortSignal?: AbortSignal;
	private _render: (ctx: Omit<Prompt<TValue>, "prompt">) => string | undefined;
	private _track = false;
	private _prevFrame = "";
	protected _cursor = 0;
	private _running = false;

	private _subscribers = new Map<string, { cb: (...args: any) => any; once?: boolean }[]>();
	private _opts: Omit<PromptOptions<TValue, Prompt<TValue>>, "render">;

	public state: BootPromptState = "initial";
	public error = "";
	public value: TValue | undefined;
	public userInput = "";

	constructor(options: PromptOptions<TValue, Prompt<TValue>>, trackValue = true) {
		const { render, signal, ...opts } = options;
		this._render = render.bind(this);
		this._track = trackValue;
		this._abortSignal = signal;
		this._opts = opts;
		this.input = opts.input ?? Deno.stdin;
		this.output = opts.output ?? Deno.stdout;
	}

	// ----------------------------
	// EVENTS
	// ----------------------------

	protected unsubscribe() {
		this._subscribers.clear();
	}

	private setSubscriber<T extends keyof BootPromptEvents<TValue>>(
		event: T,
		opts: { cb: BootPromptEvents<TValue>[T]; once?: boolean },
	) {
		const list = this._subscribers.get(event) ?? [];
		list.push(opts);
		this._subscribers.set(event, list);
	}

	public on<T extends keyof BootPromptEvents<TValue>>(event: T, cb: BootPromptEvents<TValue>[T]) {
		this.setSubscriber(event, { cb });
	}

	public once<T extends keyof BootPromptEvents<TValue>>(event: T, cb: BootPromptEvents<TValue>[T]) {
		this.setSubscriber(event, { cb, once: true });
	}

	public emit<T extends keyof BootPromptEvents<TValue>>(
		event: T,
		...data: Parameters<BootPromptEvents<TValue>[T]>
	) {
		const list = this._subscribers.get(event) ?? [];
		const cleanup: (() => void)[] = [];

		for (const sub of list) {
			sub.cb(...data);
			if (sub.once) cleanup.push(() => list.splice(list.indexOf(sub), 1));
		}

		cleanup.forEach((fn) => fn());
	}

	// ----------------------------
	// STATE SETTERS
	// ----------------------------

	protected _setValue(value: TValue | undefined) {
		this.value = value;
		this.emit("value", value);
	}

	protected _setUserInput(value = "") {
		this.userInput = value;
		this.emit("userInput", value);
	}

	protected _clearUserInput() {
		this._setUserInput("");
		this._cursor = 0;
	}

	// ----------------------------
	// RAW INPUT LOOP
	// ----------------------------

	private async _readLoop(resolve: (v: TValue | symbol | undefined) => void) {
		this._running = true;
		setRawMode(true);

		const buf = new Uint8Array(16);

		while (this._running) {
			const n = await this.input.read(buf);
			if (!n) continue;

			const seq = decoder.decode(buf.subarray(0, n));
			this.onKeypress(seq);
			this.render();

			if (this.state === "submit" || this.state === "cancel") {
				this.close();
				resolve(this.state === "cancel" ? CANCEL_SYMBOL : this.value);
				return;
			}
		}
	}

	// ----------------------------
	// KEY HANDLER
	// ----------------------------

	private _decodeKey = createKeyDecoder();

	private onKeypress(seq: string) {
		const key = this._decodeKey(seq);
		if (!key) return;
		// const name = seq === "\r"
		//   ? "return"
		//   : seq === "\x03"
		//   ? "cancel"
		//   : seq === "\x7f"
		//   ? "backspace"
		//   : undefined;

		// track input text
		if (this._track && key !== "return") {
			if (key === "backspace") {
				this.userInput = this.userInput.slice(0, -1);
			} else if (seq.length === 1 && seq >= " ") {
				this.userInput += seq;
			}

			this._cursor = this.userInput.length;
			this.emit("userInput", this.userInput);
		}

		if (this.state === "error") {
			this.state = "active";
		}

		// if (key && settings.aliases.has(key)) {
		//   this.emit("cursor", settings.aliases.get(key)!);
		// }

		if (key && settings.actions.has(key)) {
			this.emit("cursor", key);
		}

		if (seq === "y" || seq === "n") {
			this.emit("confirm", seq === "y");
		}

		this.emit("key", seq.toLowerCase(), { name: key, sequence: seq });

		if (key === "return") {
			if (this._opts?.validate) {
				const err = this._opts.validate(this.value);
				if (err) {
					this.error = err instanceof Error ? err.message : err;
					this.state = "error";
					return;
				}
			}
			this.state = "submit";
		}

		if (isActionKey([seq, key, seq], "cancel")) {
			this.state = "cancel";
		}

		if (this.state === "submit" || this.state === "cancel") {
			this.emit("finalize");
		}
	}

	// ----------------------------
	// PROMPT ENTRY
	// ----------------------------

	public prompt() {
		return new Promise<TValue | symbol | undefined>((resolve) => {
			if (this._abortSignal?.aborted) {
				this.state = "cancel";
				resolve(CANCEL_SYMBOL);
				return;
			}

			this._abortSignal?.addEventListener(
				"abort",
				() => {
					this.state = "cancel";
					this.close();
					resolve(CANCEL_SYMBOL);
				},
				{ once: true },
			);

			if (this._opts?.initialUserInput) {
				this._setUserInput(this._opts.initialUserInput);
			}

			this.render();
			this._readLoop(resolve);
		});
	}

	// ----------------------------
	// CLEANUP
	// ----------------------------

	protected close() {
		this._running = false;
		setRawMode(false);
		this.output.writeSync(encoder.encode("\n"));
		this.output.writeSync(encoder.encode(cursor.show));

		this.emit(this.state, this.value);
		this.unsubscribe();
	}

	// ----------------------------
	// RENDERING
	// ----------------------------

	private restoreCursor() {
		const cols = Deno.consoleSize().columns;
		const lines = wrapAnsi(this._prevFrame, cols, { hard: true }).split("\n").length - 1;
		this.output.writeSync(encoder.encode(cursor.move(-999, lines * -1)));
	}

	private render() {
		const cols = Deno.consoleSize().columns;
		const frame = wrapAnsi(this._render(this) ?? "", cols, {
			hard: true,
			trim: false,
		});

		if (frame === this._prevFrame) return;

		if (this.state === "initial") {
			this.output.writeSync(encoder.encode(cursor.hide));
		} else {
			// const diff = diffLines(this._prevFrame, frame);
			// const rows = getRows();

			this.restoreCursor();

			// this seems to be the problem????
			// if (diff) {
			//   const diffOffsetAfter = Math.max(0, diff.numLinesAfter - rows);
			//   const diffOffsetBefore = Math.max(0, diff.numLinesBefore - rows);
			//   let diffLine = diff.lines.find((l) => l >= diffOffsetAfter);

			//   if (diffLine !== undefined) {
			//     // single line optimization
			//     if (diff.lines.length === 1) {
			//       this.output.writeSync(
			//         encoder.encode(cursor.move(0, diffLine - diffOffsetBefore)),
			//       );
			//       this.output.writeSync(encoder.encode(erase.lines(1)));

			//       const lines = frame.split("\n");
			//       this.output.writeSync(encoder.encode(lines[diffLine]));

			//       this._prevFrame = frame;
			//       this.output.writeSync(
			//         encoder.encode(cursor.move(0, lines.length - diffLine - 1)),
			//       );
			//       return;
			//     }

			//     // multi-line repaint
			//     this.output.writeSync(encoder.encode(erase.down()));
			//     const lines = frame.split("\n").slice(diffLine);
			//     this.output.writeSync(encoder.encode(lines.join("\n")));
			//     this._prevFrame = frame;
			//     return;
			//   }
			// }

			this.output.writeSync(encoder.encode(erase.down()));
		}

		this.output.writeSync(encoder.encode(frame));

		if (this.state === "initial") {
			this.state = "active";
		}

		this._prevFrame = frame;
	}
}
