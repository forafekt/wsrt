import { createRequire } from "node:module";
import { WsrtControlPlane } from "@wsrt/control-plane";
import { definePlugin, type ExecutableContribution, type WsrtPlugin } from "@wsrt/plugins";

export type DashboardOptions = {
	enabled?: boolean;
	host?: string;
	port?: number;
	strictPort?: boolean;
	basePath?: string;
	open?: boolean;
	mutations?: boolean;
	title?: string;
	maxSnapshotBytes?: number;
	maxActionResponseBytes?: number;
	maxRequestBytes?: number;
};

export const DEFAULT_DASHBOARD_OPTIONS = Object.freeze({
	enabled: true,
	host: "127.0.0.1",
	port: 5177,
	strictPort: true,
	basePath: "/__wsrt",
	open: false,
	mutations: true,
	title: "WSRT Dashboard",
	maxSnapshotBytes: 8 * 1024 * 1024,
	maxActionResponseBytes: 1024 * 1024,
	maxRequestBytes: 64 * 1024,
});

export function normalizeDashboardOptions(
	input: DashboardOptions = {},
): Required<DashboardOptions> {
	const options = { ...DEFAULT_DASHBOARD_OPTIONS, ...input };
	if (!options.host || /[\s/]/.test(options.host))
		throw new Error(`Invalid dashboard host: ${options.host}`);
	if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
		throw new Error(`Invalid dashboard port: ${options.port}`);
	if (
		(options.basePath !== "" && !options.basePath.startsWith("/")) ||
		options.basePath.includes("?") ||
		options.basePath.includes("#") ||
		options.basePath.includes("..")
	)
		throw new Error(`Invalid dashboard base path: ${options.basePath}`);
	for (const [name, value] of [
		["maxSnapshotBytes", options.maxSnapshotBytes],
		["maxActionResponseBytes", options.maxActionResponseBytes],
		["maxRequestBytes", options.maxRequestBytes],
	] as const)
		if (!Number.isSafeInteger(value) || value < 1024)
			throw new Error(`Invalid dashboard ${name}: ${value}`);
	options.basePath = options.basePath === "/" ? "" : options.basePath.replace(/\/+$/, "");
	return options;
}

export function dashboardPlugin(options: DashboardOptions = {}): WsrtPlugin {
	const normalized = normalizeDashboardOptions(options);
	const packageMetadata = createRequire(import.meta.url)("../../package.json") as {
		readonly name: string;
		readonly version: string;
	};
	const owner = { id: packageMetadata.name, version: packageMetadata.version } as const;
	const executable: ExecutableContribution<DashboardOptions> = {
		id: "dashboard",
		description: "Start the WSRT dashboard",
		owner,
		validateOptions(input) {
			try {
				return {
					value: normalizeDashboardOptions({
						...normalized,
						...(isRecord(input) ? input : {}),
					}),
				};
			} catch (cause) {
				return {
					diagnostics: [
						{
							code: "WSRT_EXECUTABLE_INVALID_OPTIONS",
							severity: "error",
							message: cause instanceof Error ? cause.message : String(cause),
						},
					],
				};
			}
		},
		async execute(context, executableOptions) {
			const { startDashboard } = await import("../server/dashboard-host.js");
			if (!(context.controlPlane instanceof WsrtControlPlane))
				throw new Error("Dashboard executable requires a WSRT control plane");
			const dashboard = await startDashboard(context.controlPlane, executableOptions);
			context.logger.info(`WSRT Dashboard: ${dashboard.url}`);
			let release = () => {};
			const waiting = new Promise<void>((resolve) => {
				release = resolve;
			});
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				context.signal.removeEventListener("abort", close);
				await dashboard.close();
				release();
			};
			context.signal.addEventListener("abort", close, { once: true });
			return { result: { url: dashboard.url }, wait: () => waiting, close };
		},
	};
	return definePlugin({
		...owner,
		name: "Dashboard",
		description: "Live control-plane dashboard and inspection API",
		capabilities: ["dashboard", "cli"],
		contributions: {
			executables: [executable],
			dashboard: [
				{ id: "control-plane", kind: "page", title: "Control plane" },
				{ id: "plugins", kind: "page", title: "Plugins" },
			],
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export default dashboardPlugin;
