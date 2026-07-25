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
		},
	},
	services: {
		worker: {
			command: { command: "node", args: ["scripts/service.mjs"] },
			healthcheck: { type: "process" },
		},
	},
});
