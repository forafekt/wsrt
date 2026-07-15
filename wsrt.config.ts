import { defineSystem } from "@wsrt/config";

export default defineSystem({
	schemaVersion: "1",
	name: "wsrt",
	workspace: { packageManager: "pnpm" },
	plugins: [
		{
			provider: "@wsrt/plugin-dashboard",
			options: {
				host: "127.0.0.1",
				port: 5177,
				basePath: "/__wsrt",
				open: false,
			},
		},
		// { provider: "@wsrt/plugin-terraform", options: {} },
	],
	tasks: {
		architecture: {
			command: { command: "node", args: ["scripts/check-architecture.mjs"] },
		},
		lint: {
			command: { command: "pnpm", args: ["exec", "biome", "check", "."] },
		},
		typecheck: { command: { command: "pnpm", args: ["-r", "typecheck"] } },
		build: {
			command: { command: "pnpm", args: ["-r", "build"] },
			dependsOn: { typecheck: { condition: "successful" } },
		},
		test: {
			command: {
				command: "node",
				args: ["--test", "tests/*.mjs"],
				shell: true,
			},
			dependsOn: { build: { condition: "successful" } },
		},
		validate: {
			command: {
				command: "node",
				args: ["-e", "console.log('WSRT validation complete')"],
			},
			dependsOn: {
				architecture: { condition: "successful" },
				lint: { condition: "successful" },
				test: { condition: "successful" },
			},
		},
		demo: {
			command: { command: "echo", args: ["Hello World"] },
		},
	},
	artifacts: {
		build: {
			type: "workspace-build",
			producer: "build",
			location: "packages/*/dist",
		},
	},
	environments: { development: { activate: { tasks: ["typecheck"] } } },
});
