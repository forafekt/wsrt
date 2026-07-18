import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import process from "node:process";
import {
	CapabilityRegistry,
	type ProcessHandle,
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
						const timer = setTimeout(resolve, ms);
						signal?.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								reject(signal.reason);
							},
							{ once: true },
						);
					}),
			})
			.provide("logger", {
				log: (level, message, attributes) =>
					console[
						level === "warning" ? "warn" : level === "debug" ? "debug" : level
					](message, attributes ?? ""),
			})
			.provide("spawn", {
				spawn: (request) => {
					const command =
						request.command === "node" ? process.execPath : request.command;
					const child = spawn(command, [...request.args], {
						cwd: request.cwd,
						env: { ...process.env, ...request.environment },
						shell: request.shell ?? false,
						stdio: process.env.WSRT_JSON_OUTPUT === "1" ? "ignore" : "inherit",
						signal: request.signal,
						detached: process.platform !== "win32",
					});
					let running = true;
					let settled = false;
					const handle: ProcessHandle = {
						pid: child.pid ?? -1,
						get running() {
							return running;
						},
						exit: new Promise((resolve) => {
							const finish = (code: number | null, signal: string | null) => {
								if (settled) return;
								settled = true;
								running = false;
								children.delete(handle);
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
					};
					children.add(handle);
					return handle;
				},
			});
		return {
			provider: this.id,
			capabilities,
			dispose: async () => {
				for (const child of children) child.terminate();
				await Promise.allSettled([...children].map((child) => child.exit));
			},
		};
	}
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
			() =>
				finish(
					new Error(
						`TCP connection to ${host}:${port} timed out after ${timeoutMs}ms`,
					),
				),
			timeoutMs,
		);
		const abort = () =>
			finish(signal?.reason ?? new Error("TCP connection cancelled"));
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
