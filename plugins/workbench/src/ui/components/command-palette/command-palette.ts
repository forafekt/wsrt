import { dispatch, element } from "../../core/dom.js";
import type { RouteId } from "../../core/route.js";
import type { WorkspaceSnapshot } from "../../core/view-model.js";
import { defineElement, WorkbenchElement } from "../base.js";

const routes: readonly RouteId[] = [
	"overview",
	"architecture",
	"projects",
	"nodes",
	"files",
	"impact",
	"validation",
	"runtime",
	"operations",
	"diagnostics",
	"artifacts",
	"sessions",
	"settings",
];

export class CommandPalette extends WorkbenchElement {
	open = false;
	query = "";
	description?: WorkspaceSnapshot;
	static define() {
		defineElement("wsrt-workbench-command-palette", CommandPalette);
	}
	protected render() {
		if (!this.open) return document.createComment("closed");
		const input = element("input", {
			value: this.query,
			placeholder: "Search canonical IDs, names, files, operations...",
			aria: { label: "Command palette query" },
		});
		input.addEventListener("input", () => {
			this.query = input.value;
			this.update();
		});
		const box = element(
			"div",
			{
				class: "box",
				role: "dialog",
				aria: { label: "Workspace search and command palette", modal: "true" },
			},
			input,
			element("div", { class: "results" }, ...this.items().map((item) => this.item(item))),
		);
		queueMicrotask(() => input.focus());
		const overlay = element("div", { class: "palette" }, element("style", {}, styles), box);
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) dispatch(this, "wsrt:command", { command: "palette.close" });
		});
		return overlay;
	}
	private item(item: PaletteItem) {
		const button = element(
			"button",
			{ type: "button", class: "item" },
			element("b", {}, item.label),
			element("small", {}, `${item.type} · ${item.id}`),
		);
		button.addEventListener("click", () => {
			dispatch(this, "wsrt:command", { command: "palette.close" });
			dispatch(this, "wsrt:navigate", { id: item.route });
			if (item.type !== "command")
				dispatch(this, "wsrt:inspect", { id: item.id, type: item.inspectType ?? "node" });
		});
		return button;
	}
	private items(): readonly PaletteItem[] {
		const query = this.query.toLowerCase();
		const commands = routes.map((route) => ({
			id: route,
			label: `Go to ${route}`,
			type: "command",
			route,
		})) satisfies readonly PaletteItem[];
		const nodes = (this.description?.nodes ?? []).map((node) => ({
			id: node.id,
			label: node.name ?? node.id,
			type: node.kind,
			route: "nodes" as const,
			inspectType: "node" as const,
		}));
		const projects = (this.description?.projects ?? []).map((project) => ({
			id: project.id,
			label: project.name,
			type: "project",
			route: "projects" as const,
			inspectType: "project" as const,
		}));
		return [...commands, ...nodes, ...projects]
			.filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query))
			.slice(0, 80);
	}
}

type PaletteItem = Readonly<{
	id: string;
	label: string;
	type: string;
	route: RouteId;
	inspectType?: "node" | "project";
}>;

const styles = `
.palette{position:fixed;inset:0;background:#11182777;z-index:20;display:flex;justify-content:center;padding-top:11vh}.box{width:min(650px,calc(100% - 30px));height:max-content;max-height:70vh;background:var(--wsrt-color-surface);border:1px solid var(--wsrt-color-border);border-radius:8px;box-shadow:var(--wsrt-shadow-lg);overflow:hidden}
input{width:100%;height:50px;border:0;border-bottom:1px solid var(--wsrt-color-border);background:transparent;padding:0 16px;font-size:15px;outline:none;color:inherit}.results{max-height:52vh;overflow:auto;padding:7px}.item{width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:9px 10px;border-radius:7px;display:flex;gap:10px;cursor:pointer}.item:hover,.item:focus{background:var(--wsrt-color-accent-soft);outline:none}.item small{color:var(--wsrt-color-text-muted);margin-left:auto}
`;
