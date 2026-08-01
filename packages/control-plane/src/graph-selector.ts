import type { NormalizedExecutable } from "@wsrt/config";
import type { ControlPlaneState } from "./control-plane-state.js";
import { processShorthand, required } from "./utils.js";

export class GraphSelector {
	constructor(private readonly state: ControlPlaneState) {}

	resolve(value: string, kind?: NormalizedExecutable["kind"]): string {
		const definition = required(this.state.definition, "Control plane is not loaded");
		const match = definition.executables.find(
			(item) => item.id === value || item.name === value || processShorthand(item.id) === value,
		);

		console.log({
			value,
			kind,
			definition,
			match,
		});
		if (!match || (kind && match.kind !== kind))
			throw new Error(`Unknown ${kind ?? "executable"}: ${value}`);
		return match.id;
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
