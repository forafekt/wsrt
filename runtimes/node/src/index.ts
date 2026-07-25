import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import process from "node:process";
import {
	CapabilityRegistry,
	type ProcessHandle,
	type ProcessTerminationState,
	type RuntimeInstance,
	type RuntimeProvider,
} from "@wsrt/capabilities";

export class NodeRuntimeProvider implements RuntimeProvider {
	readonly id = "node";
	async detect() {
		return { available: true, version: process.version };
	}
	async create(): Promise<RuntimeInstance> {
		const children = new Set<ProcessHandle>();
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
					connect(host, port, options.timeoutMs ?? 2_000, options.signal),
			})
			.provide("timers", {
				delay: (ms, signal) =>
					new Promise((resolve, reject) => {
						if (signal?.aborted) return reject(signal.reason);
						const abort = () => {
							clearTimeout(timer);
							reject(signal?.reason);
						};
						const timer = setTimeout(() => {
							signal?.removeEventListener("abort", abort);
							resolve();
						}, ms);
						signal?.addEventListener("abort", abort, { once: true });
					}),
			})
			.provide("logger", {
				log: (level, message, attributes) =>
					console[level === "warning" ? "warn" : level === "debug" ? "debug" : level](
						message,
						attributes ?? "",
					),
			})
			.provide("spawn", {
				spawn: (request) => {
					const command = request.command === "node" ? process.execPath : request.command;
					const child = spawn(command, [...request.args], {
						cwd: request.cwd,
						env: { ...process.env, ...request.environment },
						shell: request.shell ?? false,
						stdio: process.env.WSRT_JSON_OUTPUT === "1" ? "ignore" : "inherit",
						detached: process.platform !== "win32",
					});
					let running = true;
					let settled = false;
					let terminationState: ProcessTerminationState = "running";
					let termination: Promise<void> | undefined;
					const handle: ProcessHandle = {
						pid: child.pid ?? -1,
						get running() {
							return running;
						},
						get terminationState() {
							return terminationState;
						},
						exit: new Promise((resolve) => {
							const finish = (code: number | null, signal: string | null) => {
								if (settled) return;
								settled = true;
								running = false;
								if (terminationState === "running") terminationState = "stopped";
								children.delete(handle);
								request.signal?.removeEventListener("abort", abort);
								resolve({ code, signal });
							};
							child.once("exit", finish);
							child.once("error", () => finish(null, "SPAWN_ERROR"));
						}),
						terminate: (signal = "SIGTERM") => {
							if (!running || !child.pid) return;
							if (process.platform !== "win32") {
								try {
									process.kill(-child.pid, signal as NodeJS.Signals);
								} catch {}
							} else child.kill(signal as NodeJS.Signals);
						},
						terminateTree: (options = {}) => {
							if (termination) return termination;
							if (!running && !treeExists(child.pid ?? -1)) return Promise.resolve();
							terminationState = "stop-requested";
							termination = terminateProcessTree(
								handle,
								options.graceMs ?? request.terminationGraceMs ?? 3000,
								options.signal,
								(state) => {
									terminationState = state;
								},
							).catch((cause) => {
								terminationState = "failed";
								throw cause;
							});
							return termination;
						},
					};
					const abort = () => void handle.terminateTree().catch(() => {});
					if (request.signal?.aborted) abort();
					else request.signal?.addEventListener("abort", abort, { once: true });
					children.add(handle);
					return handle;
				},
			});
		return {
			provider: this.id,
			capabilities,
			dispose: async () => {
				await Promise.allSettled([...children].map((child) => child.terminateTree()));
			},
		};
	}
}

async function terminateProcessTree(
	handle: ProcessHandle,
	graceMs: number,
	signal?: AbortSignal,
	setState: (state: ProcessTerminationState) => void = () => {},
): Promise<void> {
	if (!handle.running && !treeExists(handle.pid)) return;
	setState("terminating");
	await signalTree(handle.pid, false);
	await waitForTreeExit(handle.pid, Math.max(0, graceMs), signal);
	if (treeExists(handle.pid)) {
		setState("forcing");
		await signalTree(handle.pid, true);
	}
	await handle.exit;
	await waitForTreeExit(handle.pid, Math.max(1000, graceMs), signal);
	if (treeExists(handle.pid))
		throw new Error(`Process tree ${handle.pid} remained alive after forced termination`);
	setState("stopped");
}

async function signalTree(pid: number, force: boolean): Promise<void> {
	if (pid <= 0) return;
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
			code === 0 || !handleExists(pid)
				? resolve()
				: reject(new Error(`taskkill exited with code ${code}`)),
		);
	});
}

function handleExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function treeExists(pid: number): boolean {
	if (process.platform === "win32") return handleExists(pid);
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForTreeExit(
	pid: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (treeExists(pid) && Date.now() < deadline) await delay(20, signal);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new DOMException("Termination cancelled", "AbortError"));
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function connect(
	host: string,
	port: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host, port });
		const timer = setTimeout(
			() => finish(new Error(`TCP connection to ${host}:${port} timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
		const abort = () => finish(signal?.reason ?? new Error("TCP connection cancelled"));
		const finish = (error?: unknown) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			socket.destroy();
			error ? reject(error) : resolve();
		};
		socket.once("connect", () => finish());
		socket.once("error", finish);
		signal?.addEventListener("abort", abort, { once: true });
	});
}
