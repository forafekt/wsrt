import type { NormalizedExecutable } from "@wsrt/config";
import type { SystemGraph } from "@wsrt/graph";
import type { ControlPlaneState } from "./control-plane-state.js";
import { ControlPlaneError } from "./types.js";
import { canonicalProcessId, processShorthand, required } from "./utils.js";

export class GraphSelector {
	constructor(private readonly state: ControlPlaneState) {}

	resolveExecutable(value: string): NormalizedExecutable {
		const definition = required(this.state.definition, "Control plane is not loaded");
		const canonicalValue = canonicalProcessId(value);
		const canonical = definition.executables.find((item) => item.id === canonicalValue);
		if (canonical) return canonical;
		const matches = definition.executables.filter(
			(item) => item.name === value || processShorthand(item.id) === value,
		);
		if (matches.length === 1) return required(matches[0], "Selector match disappeared");
		if (matches.length > 1)
			throw new ControlPlaneError(
				"selector.ambiguous",
				`Ambiguous executable ${JSON.stringify(value)}; use one of: ${matches.map((item) => item.id).join(", ")}`,
				{ value, alternatives: matches.map((item) => item.id) },
			);
		throw new ControlPlaneError(
			"selector.not_found",
			`Unknown executable ${JSON.stringify(value)}`,
			{ value, alternatives: definition.executables.map((item) => item.id) },
		);
	}

	resolveNode(value: string): NormalizedExecutable {
		return this.resolveExecutable(value);
	}

	resolveTask(value: string): NormalizedExecutable {
		const match = this.resolveExecutable(value);
		if (match.kind !== "task")
			throw new ControlPlaneError(
				"selector.kind_mismatch",
				`Expected task ${JSON.stringify(value)}, but ${match.id} is an ${match.kind}`,
				{ value, expectedKind: "task", actualKind: match.kind, resolvedId: match.id },
			);
		return match;
	}

	executableIds(): string[] {
		return required(this.state.definition, "Control plane is not loaded").executables.map(
			(item) => item.id,
		);
	}

	longRunningIds(): string[] {
		return required(this.state.definition, "Control plane is not loaded")
			.executables.filter((item) => item.kind !== "task" && !item.id.includes("/process:"))
			.map((item) => item.id);
	}

	closure(ids: readonly string[]): string[] {
		const graph = required(this.state.graph, "Control plane is not loaded");
		return selectStartClosure(graph, ids);
	}

	dependants(ids: readonly string[]): string[] {
		const graph = required(this.state.graph, "Control plane is not loaded");
		const result = new Set(ids);
		const visit = (id: string): void => {
			const related = [...graph.consumers(id), ...graph.neighbors(id, "out", "contains")];
			for (const node of related) {
				if (result.has(node.id)) continue;
				result.add(node.id);
				visit(node.id);
			}
		};
		for (const id of ids) visit(id);
		return [...result];
	}
}

export function selectStartClosure(graph: SystemGraph, ids: readonly string[]): string[] {
	const result = new Set(ids);
	const visit = (id: string): void => {
		const related = [...graph.dependencies(id), ...graph.neighbors(id, "out", "contains")];
		for (const node of related) {
			if (node.kind === "artifact" || result.has(node.id)) continue;
			result.add(node.id);
			visit(node.id);
		}
	};
	for (const id of ids) visit(id);
	return [...result];
}
