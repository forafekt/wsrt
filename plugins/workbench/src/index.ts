export type { WorkbenchOptions } from "./plugin.js";
export {
	normalizeWorkbenchOptions,
	workbenchPlugin,
	workbenchPlugin as default,
} from "./plugin.js";
export type { WorkbenchHandle } from "./server.js";
export { createWorkbenchServer, startWorkbench } from "./server.js";
