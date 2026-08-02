export { releaseVersion } from "./package-metadata.mjs";

// This is the single publication-policy catalog. Every workspace manifest must
// have exactly one entry; scripts must not carry their own package exceptions.
export const packageCatalog = Object.freeze(
	[
		["wsrt", "packages/wsrt", "public-fixed"],
		["@wsrt/ansi-tools", "libraries/ansi-tools", "public-fixed"],
		["@wsrt/argparse", "libraries/argparse", "public-fixed"],
		["@wsrt/capabilities", "packages/capabilities", "public-fixed"],
		["@wsrt/cli", "packages/cli", "public-fixed"],
		["@wsrt/commandline", "libraries/commandline", "public-fixed"],
		["@wsrt/config", "packages/config", "public-fixed"],
		["@wsrt/console", "libraries/console", "public-fixed"],
		["@wsrt/control-plane", "packages/control-plane", "public-fixed"],
		["@wsrt/di", "libraries/di", "public-fixed"],
		["@wsrt/event-targets", "libraries/event-targets", "public-fixed"],
		["@wsrt/graph", "packages/graph", "public-fixed"],
		["@wsrt/lifecycle", "packages/lifecycle", "public-fixed"],
		["@wsrt/mcp", "packages/mcp", "public-fixed"],
		["@wsrt/persistence", "packages/persistence", "public-fixed"],
		["@wsrt/persistence-filesystem", "packages/persistence-filesystem", "public-fixed"],
		["@wsrt/persistence-memory", "packages/persistence-memory", "public-fixed"],
		["@wsrt/plugin-dashboard", "plugins/dashboard", "public-fixed"],
		["@wsrt/plugin-workbench", "plugins/workbench", "public-fixed"],
		["@wsrt/plugin-vite", "plugins/vite", "public-fixed"],
		["@wsrt/plugins", "packages/plugins", "public-fixed"],
		["@wsrt/runtime-node", "runtimes/node", "public-fixed"],
		["@wsrt/workspace", "packages/workspace", "public-fixed"],
		["@wsrt/artifacts", "packages/artifacts", "private-tooling"],
		["@wsrt/diagnostics", "packages/diagnostics", "private-tooling"],
		["@wsrt/environment", "packages/environment", "private-tooling"],
		["@wsrt/events", "packages/events", "private-tooling"],
		["@wsrt/runtime-rust", "runtimes/rust", "private-tooling"],
		["@wsrt/worker-pool", "libraries/worker-pool", "private-tooling"],
		["wsrt-workspace", ".", "private-tooling"],
		["wsrt-external-consumer-fixture", "tests/fixtures/external-consumer", "fixture"],
		["@fixture/lib", "tests/fixtures/external-consumer/apps/lib", "fixture"],
		["@fixture/web", "tests/fixtures/external-consumer/apps/web", "fixture"],
	].map(([name, directory, classification]) => ({ name, directory, classification })),
);

export const publicPackageRecords = Object.freeze(
	packageCatalog.filter(({ classification }) => classification.startsWith("public-")),
);

export const publicPackages = Object.freeze(publicPackageRecords.map(({ name }) => name));

export const privatePackages = Object.freeze(
	packageCatalog
		.filter(({ classification }) => classification === "private-tooling")
		.map(({ name }) => name),
);
