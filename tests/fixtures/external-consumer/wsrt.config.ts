import { defineSystem } from "@wsrt/config";

export default defineSystem({
	schemaVersion: "1",
	name: "packed-external-consumer",
	workspace: { packageManager: "pnpm" },
	plugins: [
		{
			provider: "@wsrt/plugin-vite",
			options: {
				project: "apps/web",
				workspace: { discover: true, aliases: true },
			},
		},
	],
	tasks: {
		hello: { command: { command: "node", args: ["scripts/hello.mjs"] } },
		webBuild: {
			root: "apps/web",
			provider: { provider: "vite", options: { command: "build" } },
			dependsOn: { hello: { condition: "successful" } },
			sources: ["apps/web/src.js"],
			entrypoints: ["apps/web/index.html"],
			configuration: ["apps/web/package.json"],
			inputs: ["apps/lib/src/**"],
		},
	},
	services: {
		worker: {
			command: { command: "node", args: ["scripts/service.mjs"] },
			healthcheck: { type: "process" },
		},
	},
});
