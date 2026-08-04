import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame } from "../page.js";

export function renderSessionsPage(context: PageContext) {
	const handshake = context.data?.handshake;
	return pageFrame(
		"Session",
		"Authoritative workspace host, transport, protocol, revision, capabilities, subscriptions, and reconnect state.",
		element(
			"section",
			{ class: "surface surface-pad" },
			element(
				"dl",
				{},
				row("Session", handshake?.sessionId),
				row("Protocol", String(handshake?.protocolVersion ?? "-")),
				row("Workspace", handshake?.workspaceId),
				row("State", handshake?.state),
			),
		),
	);
}

function row(label: string, value?: string) {
	return element(
		"div",
		{ class: "detail-row" },
		element("dt", {}, label),
		element("dd", {}, value ?? "-"),
	);
}
