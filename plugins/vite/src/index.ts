import type { Plugin } from "vite";
export type ViteIntegrationOptions = {
	root?: string;
	configFile?: string;
	command?: "dev" | "build";
	host?: string;
	port?: number;
};
export type ViteContribution = {
	name: "vite";
	provider: { provider: "vite"; options: ViteIntegrationOptions };
	command: { command: string; args: string[]; shell: false };
	healthcheck?: { type: "http"; url: string };
};
export function viteContribution(
	options: ViteIntegrationOptions = {},
): ViteContribution {
	const args = [options.command === "build" ? "build" : "dev"];
	if (options.configFile) args.push("--config", options.configFile);
	if (options.host) args.push("--host", options.host);
	if (options.port) args.push("--port", String(options.port));
	return {
		name: "vite",
		provider: { provider: "vite", options },
		command: { command: "vite", args, shell: false },
		healthcheck:
			options.command === "build"
				? undefined
				: {
						type: "http",
						url: `http://${options.host ?? "127.0.0.1"}:${options.port ?? 5173}`,
					},
	};
}
export default function wsrtVitePlugin(): Plugin {
	return { name: "wsrt", configResolved() {} };
}
export function hasWsrtVitePlugin(plugins: unknown): boolean {
	return (
		Array.isArray(plugins) &&
		plugins.some(
			(plugin) =>
				Boolean(plugin) &&
				typeof plugin === "object" &&
				(plugin as { name?: unknown }).name === "wsrt",
		)
	);
}
