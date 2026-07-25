import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
	RUST_RUNTIME_PROTOCOL_VERSION,
	type RustRuntimeEvent,
	type RustRuntimeMessage,
	type RustRuntimeRequestMap,
	type RustRuntimeResultMap,
} from "./protocol.js";

export type RustRuntimeClientOptions = {
	binary: string;
	args?: readonly string[];
	cwd?: string;
	environment?: NodeJS.ProcessEnv;
};

type PendingRequest = {
	resolve(value: unknown): void;
	reject(error: Error): void;
};

export class RustRuntimeRequestError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "RustRuntimeRequestError";
	}
}

export class RustRuntimeClient extends EventTarget {
	readonly #options: RustRuntimeClientOptions;
	readonly #pending = new Map<string, PendingRequest>();
	#process?: ChildProcessWithoutNullStreams;
	#state: "created" | "starting" | "ready" | "stopping" | "stopped" | "failed" = "created";
	#exit?: Promise<void>;

	constructor(options: RustRuntimeClientOptions) {
		super();
		this.#options = options;
	}

	get state(): string {
		return this.#state;
	}

	async start(): Promise<void> {
		if (this.#state === "ready") return;
		if (this.#state !== "created")
			throw new Error(`Rust runtime cannot start while ${this.#state}`);
		this.#state = "starting";
		const child = spawn(this.#options.binary, [...(this.#options.args ?? [])], {
			cwd: this.#options.cwd,
			env: { ...process.env, ...this.#options.environment },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#process = child;
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (data: string) =>
			this.dispatchEvent(new CustomEvent("diagnostic", { detail: data })),
		);
		const lines = createInterface({
			input: child.stdout,
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		lines.on("line", (line) => this.#handleLine(line));
		this.#exit = new Promise((resolve) => {
			child.once("exit", (code, signal) => {
				const expected = this.#state === "stopping" || this.#state === "stopped";
				this.#process = undefined;
				this.#state = expected ? "stopped" : "failed";
				const error = new Error(
					`Rust runtime exited with code ${String(code)} and signal ${String(signal)}`,
				);
				this.#rejectAll(error);
				if (!expected)
					this.dispatchEvent(new CustomEvent("runtimeExit", { detail: { code, signal } }));
				resolve();
			});
		});
		child.once("error", (error) => {
			this.#state = "failed";
			this.#rejectAll(error);
		});
		try {
			const ping = await this.request("ping");
			if (ping.protocolVersion !== RUST_RUNTIME_PROTOCOL_VERSION)
				throw new Error(`Unsupported Rust runtime protocol ${ping.protocolVersion}`);
			this.#state = "ready";
		} catch (error) {
			child.kill();
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (this.#state === "created" || this.#state === "stopped") {
			this.#state = "stopped";
			return;
		}
		const child = this.#process;
		if (!child) return;
		this.#state = "stopping";
		try {
			await this.request("shutdown");
		} catch {
			child.kill();
		}
		child.stdin.end();
		await this.#exit;
	}

	/** Immediately terminates the native host. Intended for crash recovery and tests. */
	forceStop(): boolean {
		return this.#process?.kill("SIGKILL") ?? false;
	}

	request<K extends keyof RustRuntimeRequestMap>(
		method: K,
		...args: RustRuntimeRequestMap[K] extends undefined ? [] : [RustRuntimeRequestMap[K]]
	): Promise<RustRuntimeResultMap[K]> {
		const child = this.#process;
		if (
			!child ||
			(this.#state !== "starting" && this.#state !== "ready" && this.#state !== "stopping")
		)
			return Promise.reject(new Error(`Rust runtime is not available (${this.#state})`));
		const id = randomUUID();
		const result = new Promise<unknown>((resolve, reject) =>
			this.#pending.set(id, { resolve, reject }),
		);
		const params = args[0];
		child.stdin.write(
			`${JSON.stringify({ protocolVersion: RUST_RUNTIME_PROTOCOL_VERSION, id, method, ...(params === undefined ? {} : { params }) })}\n`,
			(error) => {
				if (!error) return;
				const pending = this.#pending.get(id);
				this.#pending.delete(id);
				pending?.reject(error);
			},
		);
		return result as Promise<RustRuntimeResultMap[K]>;
	}

	#handleLine(line: string): void {
		let message: RustRuntimeMessage;
		try {
			message = JSON.parse(line) as RustRuntimeMessage;
		} catch {
			this.dispatchEvent(
				new CustomEvent("protocolError", {
					detail: { line, message: "Invalid JSON from Rust runtime" },
				}),
			);
			return;
		}
		if (message.type === "event") {
			this.dispatchEvent(
				new CustomEvent(message.event, {
					detail: (message as RustRuntimeEvent).payload,
				}),
			);
			return;
		}
		if (typeof message.id !== "string") return;
		const pending = this.#pending.get(message.id);
		if (!pending) return;
		this.#pending.delete(message.id);
		if (message.type === "error")
			pending.reject(
				new RustRuntimeRequestError(
					message.error.code,
					message.error.message,
					message.error.details,
				),
			);
		else pending.resolve(message.result);
	}

	#rejectAll(error: Error): void {
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}
}
