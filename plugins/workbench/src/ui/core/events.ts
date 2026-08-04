import type { RouteTarget } from "./route.js";

export type InspectTarget = Readonly<{
	id: string;
	type: "node" | "project" | "file" | "operation" | "diagnostic" | "artifact";
}>;

export type WorkbenchEventMap = {
	"wsrt:navigate": RouteTarget;
	"wsrt:inspect": InspectTarget;
	"wsrt:command": Readonly<{ command: string; target?: string }>;
	"wsrt:close-inspector": undefined;
	"wsrt:retry": undefined;
	"wsrt:execute-plan": Readonly<{ taskIds: readonly string[] }>;
};
