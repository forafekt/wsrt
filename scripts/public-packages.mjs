export { releaseVersion } from "./package-metadata.mjs";

export const publicPackages = Object.freeze([
	"wsrt",
	"@wsrt/ansi-tools",
	"@wsrt/argparse",
	"@wsrt/capabilities",
	"@wsrt/cli",
	"@wsrt/commandline",
	"@wsrt/config",
	"@wsrt/console",
	"@wsrt/control-plane",
	"@wsrt/di",
	"@wsrt/event-targets",
	"@wsrt/graph",
	"@wsrt/lifecycle",
	"@wsrt/mcp",
	"@wsrt/plugin-dashboard",
	"@wsrt/plugin-vite",
	"@wsrt/plugins",
	"@wsrt/runtime-node",
	"@wsrt/workspace",
]);

export const privatePackages = Object.freeze([
	"@wsrt/artifacts",
	"@wsrt/diagnostics",
	"@wsrt/environment",
	"@wsrt/events",
	"@wsrt/runtime-rust",
	"@wsrt/worker-pool",
]);
