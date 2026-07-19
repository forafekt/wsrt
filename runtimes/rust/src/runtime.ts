import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	CapabilityRegistry,
	type ProcessHandle,
	type RuntimeInstance,
	type RuntimeProvider,
} from "@wsrt/capabilities";
import { RustRuntimeClient, type RustRuntimeClientOptions } from "./client.js";

export type RustRuntimeProviderOptions = Partial<Pick<RustRuntimeClientOptions, "binary">> &
	Omit<RustRuntimeClientOptions, "binary">;

export class RustRuntimeProvider implements RuntimeProvider {
	readonly id = "rust";
	readonly #options: RustRuntimeClientOptions;
	constructor(options: RustRuntimeProviderOptions = {}) {
		this.#options = {
			...options,
			binary: options.binary ?? resolveRustRuntimeBinary(),
		};
	}
	async detect() {
		const client = new RustRuntimeClient(this.#options);
		try {
			await client.start();
			const version = (await client.request("ping")).version;
			await client.stop();
			return { available: true, version };
		} catch {
			await client.stop().catch(() => {});
			return { available: false };
		}
	}
	async create(): Promise<RuntimeInstance> {
		const client = new RustRuntimeClient(this.#options);
		await client.start();
		const handles = new Map<
			string,
			{
				handle: ProcessHandle;
				resolve(exit: { code: number | null; signal: string | null }): void;
			}
		>();
		client.addEventListener("output", (event) => {
			if (process.env.WSRT_JSON_OUTPUT === "1") return;
			const output = (event as CustomEvent<{ stream: "stdout" | "stderr"; data: string }>).detail;
			(output.stream === "stdout" ? process.stdout : process.stderr).write(output.data);
		});
		client.addEventListener("exit", (event) => {
			const value = (
				event as CustomEvent<{
					id: string;
					code: number | null;
					signal: string | null;
				}>
			).detail;
			const managed = handles.get(value.id);
			if (!managed) return;
			handles.delete(value.id);
			managed.resolve({ code: value.code, signal: value.signal });
		});
		client.addEventListener("runtimeExit", () => {
			for (const [id, managed] of handles) {
				handles.delete(id);
				managed.resolve({ code: null, signal: "RUNTIME_EXIT" });
			}
		});
		const capabilities = new CapabilityRegistry()
			.provide("filesystem", {
				readText: (file) => fs.readFile(file, "utf8"),
				writeText: (file, value) => fs.writeFile(file, value),
				exists: async (file) =>
					fs.access(file).then(
						() => true,
						() => false,
					),
			})
			.provide("environment", {
				all: () => ({ ...process.env }),
				get: (name) => process.env[name],
			})
			.provide("process", {
				cwd: () => process.cwd(),
				pid: () => process.pid,
				platform: () => process.platform,
			})
			.provide("http", { fetch: (input, init) => fetch(input, init) })
			.provide("network", {
				connect: (host, port, options = {}) =>
					abortable(
						client.request("connect", {
							host,
							port,
							timeoutMs: options.timeoutMs ?? 2_000,
						}),
						options.signal,
					),
			})
			.provide("timers", { delay: (ms, signal) => delay(ms, signal) })
			.provide("logger", {
				log: (level, message, attributes) =>
					console[level === "warning" ? "warn" : level](message, attributes ?? ""),
			})
			.provide("spawn", {
				spawn: (request) => {
					const id = randomUUID();
					let running = true;
					let resolve!: (value: { code: number | null; signal: string | null }) => void;
					const exit = new Promise<{
						code: number | null;
						signal: string | null;
					}>((done) => {
						resolve = (value) => {
							running = false;
							done(value);
						};
					});
					const spawned = client.request("spawn", {
						id,
						command: request.command,
						args: [...request.args],
						cwd: request.cwd,
						environment: { ...request.environment },
						shell: request.shell ?? false,
					});
					const handle: ProcessHandle = {
						pid: -1,
						get running() {
							return running;
						},
						exit,
						terminate: (signal = "SIGTERM") => {
							if (running)
								void spawned
									.then(() => client.request("terminate", { id, signal }))
									.catch(() => {});
						},
					};
					handles.set(id, { handle, resolve });
					void spawned.then(
						({ pid }) => {
							Object.defineProperty(handle, "pid", {
								value: pid,
								enumerable: true,
							});
						},
						() => {
							handles.delete(id);
							resolve({ code: null, signal: "SPAWN_ERROR" });
						},
					);
					if (request.signal) {
						const cancel = () => handle.terminate("SIGTERM");
						if (request.signal.aborted) cancel();
						else request.signal.addEventListener("abort", cancel, { once: true });
					}
					return handle;
				},
			});
		return {
			provider: this.id,
			capabilities,
			dispose: async () => {
				await client.stop();
			},
		};
	}
}

export function resolveRustRuntimeBinary(root = process.cwd()): string {
	if (process.env.WSRT_RUST_RUNTIME_BINARY) return process.env.WSRT_RUST_RUNTIME_BINARY;
	const name = process.platform === "win32" ? "wsrt-runtime.exe" : "wsrt-runtime";
	return path.resolve(
		root,
		"target",
		process.env.WSRT_RUST_PROFILE === "release" ? "release" : "debug",
		name,
	);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
