import { dispatch, element } from "../../core/dom.js";
import { messageFromCause } from "../../core/errors.js";
import type { InspectTarget } from "../../core/events.js";
import type { WorkspaceClient } from "../../core/workspace-client.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class Inspector extends WorkbenchElement {
	target?: InspectTarget;
	client?: WorkspaceClient;
	detail?: unknown;
	loading = false;
	#request?: AbortController;
	#requestId = 0;
	static define() {
		defineElement("wsrt-workbench-inspector", Inspector);
	}
	protected render() {
		if (!this.target) return document.createComment("closed");
		const close = element(
			"button",
			{ type: "button", class: "icon", aria: { label: "Close inspector" } },
			"×",
		);
		close.addEventListener("click", () => dispatch(this, "wsrt:close-inspector", undefined));
		return element(
			"aside",
			{ aria: { label: "Context inspector" } },
			element("style", {}, styles),
			element(
				"header",
				{},
				element(
					"div",
					{},
					element("b", {}, labelFor(this.detail, this.target.id)),
					element("small", {}, this.target.type),
				),
				close,
			),
			element("div", { class: "body" }, this.body()),
		);
	}
	async load() {
		if (!this.client || !this.target) return;
		const target = this.target;
		this.#request?.abort();
		const request = new AbortController();
		const requestId = ++this.#requestId;
		this.#request = request;
		this.loading = true;
		this.detail = undefined;
		this.update();
		try {
			if (target.type === "node")
				this.detail = await this.client.request(
					{
						type: "workspace.node.describe",
						nodeId: target.id,
						options: { aggregate: true, depth: 2, include: ["children", "relationships"] },
					},
					request.signal,
				);
			else if (target.type === "artifact")
				this.detail = await this.client.request(
					{
						type: "workspace.artifact.describe",
						nodeId: target.id,
					},
					request.signal,
				);
			else if (target.type === "file")
				this.detail = await this.client.request(
					{ type: "workspace.file.owners", path: target.id },
					request.signal,
				);
			else this.detail = { id: target.id, type: target.type };
		} catch (cause) {
			if (request.signal.aborted) return;
			this.detail = { id: target.id, error: messageFromCause(cause) };
		} finally {
			if (requestId === this.#requestId) {
				this.loading = false;
				this.update();
			}
		}
	}
	disconnectedCallback() {
		this.#request?.abort();
	}
	private body() {
		if (this.loading) return element("p", { class: "empty" }, "Loading authoritative detail...");
		const value = unwrap(this.detail);
		if (!value || typeof value !== "object")
			return element("p", { class: "empty" }, "No detail loaded.");
		const record = value as Record<string, unknown>;
		return element(
			"section",
			{},
			record.error ? element("p", { class: "banner" }, String(record.error)) : undefined,
			element("h3", {}, "Summary"),
			element(
				"dl",
				{},
				...["id", "canonicalId", "kind", "projectId", "lifecycleState"].map((key) =>
					element(
						"div",
						{ class: "row" },
						element("dt", {}, key),
						element("dd", {}, String(record[key] ?? "-")),
					),
				),
			),
			this.files(record.files),
			this.evidence(record.evidence),
		);
	}
	private files(value: unknown) {
		const files = Array.isArray(value) ? value.slice(0, 30) : [];
		if (!files.length) return element("p", { class: "empty" }, "No declared file associations.");
		return element(
			"section",
			{},
			element("h3", {}, "Files"),
			element(
				"ul",
				{},
				...files.map((file) => {
					const record = file as Record<string, unknown>;
					return element(
						"li",
						{},
						element("b", {}, String(record.path ?? "-")),
						element("small", {}, String(record.role ?? "")),
					);
				}),
			),
		);
	}
	private evidence(value: unknown) {
		const evidence = Array.isArray(value) ? value.slice(0, 12) : [];
		if (!evidence.length)
			return element("p", { class: "empty" }, "No evidence records on this detail.");
		return element(
			"section",
			{},
			element("h3", {}, "Evidence"),
			...evidence.map((entry) => {
				const record = entry as Record<string, unknown>;
				return element(
					"article",
					{ class: "evidence" },
					element("b", {}, String(record.source ?? record.type ?? "evidence")),
					element("p", {}, String(record.reason ?? "")),
				);
			}),
		);
	}
}

function unwrap(value: unknown) {
	return value && typeof value === "object" && "result" in value
		? (value as { result: unknown }).result
		: value;
}

function labelFor(value: unknown, fallback: string) {
	const detail = unwrap(value);
	if (!detail || typeof detail !== "object") return fallback;
	const record = detail as Record<string, unknown>;
	return String(record.name ?? record.id ?? fallback);
}

const styles = `
:host{display:contents}
aside{border-left:1px solid var(--wsrt-color-border);background:var(--wsrt-color-surface);min-width:0;box-shadow:var(--wsrt-shadow-lg);z-index:3}
header{height:64px;padding:12px 16px;border-bottom:1px solid var(--wsrt-color-border);display:flex;align-items:center;gap:10px;position:sticky;top:0;background:var(--wsrt-color-surface);z-index:2}header div{flex:1;min-width:0}b,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:var(--wsrt-color-text-muted)}.icon{border:0;background:transparent;color:inherit;border-radius:7px;width:32px;height:32px;cursor:pointer}.icon:hover{background:var(--wsrt-color-surface-subtle)}
.body{overflow:auto;padding:17px}h3{font-size:12px;margin:0 0 10px}.row{display:grid;grid-template-columns:105px 1fr;gap:8px;margin:7px 0}dt{color:var(--wsrt-color-text-muted)}dd{margin:0;overflow-wrap:anywhere}.empty{padding:16px;color:var(--wsrt-color-text-muted);text-align:center}.banner{padding:9px 13px;border:1px solid var(--wsrt-color-danger-border);background:var(--wsrt-color-danger-surface);color:var(--wsrt-color-danger);border-radius:7px}.evidence{padding:10px;border:1px solid var(--wsrt-color-border);border-radius:7px;margin:7px 0;background:var(--wsrt-color-surface-subtle)}ul{list-style:none;margin:0;padding:0}li{padding:8px 0;border-bottom:1px solid var(--wsrt-color-border)}
`;
