import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	CapabilityRegistry,
	type ProcessHandle,
	type ProcessTerminationState,
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
					let terminationState: ProcessTerminationState = "running";
					let termination: Promise<void> | undefined;
					let resolve!: (value: { code: number | null; signal: string | null }) => void;
					const exit = new Promise<{
						code: number | null;
						signal: string | null;
					}>((done) => {
						resolve = (value) => {
							running = false;
							if (terminationState === "running") terminationState = "stopped";
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
						get terminationState() {
							return terminationState;
						},
						exit,
						terminate: (signal = "SIGTERM") => {
							if (running)
								void spawned
									.then(() => client.request("terminate", { id, signal }))
									.catch(() => {});
						},
						terminateTree: (options = {}) => {
							if (termination) return termination;
							if (!running && !treeExists(handle.pid)) return Promise.resolve();
							terminationState = "stop-requested";
							termination = (async () => {
								terminationState = "terminating";
								await spawned;
								if (running) await client.request("terminate", { id, signal: "SIGTERM" });
								else await signalTree(handle.pid, false);
								const graceMs = options.graceMs ?? request.terminationGraceMs ?? 3000;
								await waitForTreeExit(handle.pid, graceMs, options.signal);
								if (treeExists(handle.pid)) {
									terminationState = "forcing";
									if (running) await client.request("terminate", { id, signal: "SIGKILL" });
									else await signalTree(handle.pid, true);
								}
								await exit;
								await waitForTreeExit(handle.pid, Math.max(1000, graceMs), options.signal);
								if (treeExists(handle.pid))
									throw new Error(
										`Process tree ${handle.pid} remained alive after forced termination`,
									);
								terminationState = "stopped";
							})().catch((cause) => {
								terminationState = "failed";
								throw cause;
							});
							return termination;
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
						const cancel = () => void handle.terminateTree().catch(() => {});
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

function treeExists(pid: number): boolean {
	if (pid <= 0) return false;
	try {
		process.kill(process.platform === "win32" ? pid : -pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForTreeExit(pid: number, timeoutMs: number, signal?: AbortSignal) {
	const deadline = Date.now() + Math.max(0, timeoutMs);
	while (treeExists(pid) && Date.now() < deadline) await delay(20, signal);
}

async function signalTree(pid: number, force: boolean): Promise<void> {
	if (process.platform !== "win32") {
		try {
			process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
		}
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const killer = spawn("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
			windowsHide: true,
			stdio: "ignore",
		});
		killer.once("error", reject);
		killer.once("exit", (code) =>
			code === 0 || !treeExists(pid)
				? resolve()
				: reject(new Error(`taskkill exited with code ${code}`)),
		);
	});
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
