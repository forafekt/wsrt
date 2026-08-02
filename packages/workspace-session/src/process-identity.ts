import fs from "node:fs/promises";

export interface ProcessIdentity {
	readonly pid: number;
	readonly startedAt: string;
	readonly executable?: string;
}

export interface ProcessIdentityProvider {
	current(): Promise<ProcessIdentity>;
	inspect(pid: number): Promise<ProcessIdentity | undefined>;
}

export class PlatformProcessIdentityProvider implements ProcessIdentityProvider {
	current(): Promise<ProcessIdentity> {
		return this.inspect(process.pid).then((identity) => {
			if (!identity)
				throw Object.assign(new Error("Unable to inspect the current process"), {
					code: "process.identity_unavailable",
				});
			return identity;
		});
	}
	async inspect(pid: number): Promise<ProcessIdentity | undefined> {
		if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
		if (process.platform === "linux") return linuxIdentity(pid);
		try {
			process.kill(pid, 0);
			return {
				pid,
				startedAt: `portable:${pid}`,
				...(pid === process.pid ? { executable: process.execPath } : {}),
			};
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ESRCH") return undefined;
			throw Object.assign(new Error(`Process identity for pid ${pid} is inaccessible`), {
				code: "process.identity_inaccessible",
				cause,
			});
		}
	}
}

async function linuxIdentity(pid: number): Promise<ProcessIdentity | undefined> {
	try {
		const [stat, bootId, executable] = await Promise.all([
			fs.readFile(`/proc/${pid}/stat`, "utf8"),
			fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
			fs.readlink(`/proc/${pid}/exe`).catch((cause) => {
				if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw cause;
			}),
		]);
		const close = stat.lastIndexOf(")");
		if (close < 0) throw new Error("Malformed Linux process stat record");
		const fields = stat
			.slice(close + 2)
			.trim()
			.split(/\s+/);
		const startTicks = fields[19];
		if (!startTicks) throw new Error("Linux process stat has no start time");
		return {
			pid,
			startedAt: `linux:${bootId.trim()}:${startTicks}`,
			...(executable ? { executable } : {}),
		};
	} catch (cause) {
		if (["ENOENT", "ESRCH"].includes((cause as NodeJS.ErrnoException).code ?? "")) return undefined;
		if (["EACCES", "EPERM"].includes((cause as NodeJS.ErrnoException).code ?? ""))
			throw Object.assign(new Error(`Process identity for pid ${pid} is inaccessible`), {
				code: "process.identity_inaccessible",
				cause,
			});
		throw Object.assign(new Error(`Unable to inspect process identity for pid ${pid}`), {
			code: "process.identity_indeterminate",
			cause,
		});
	}
}
