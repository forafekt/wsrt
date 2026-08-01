import type { WsrtControlPlane } from "@wsrt/control-plane";
import { protocolError, type WorkspaceRequest } from "./protocol.js";

export class WorkspaceRequestRouter {
	constructor(
		readonly plane: WsrtControlPlane,
		readonly handshake: () => unknown,
		readonly status: () => unknown,
		readonly stop: () => void,
	) {}
	async route(request: WorkspaceRequest): Promise<unknown> {
		switch (request.type) {
			case "session.handshake":
				return this.handshake();
			case "session.status":
				return this.status();
			case "session.stop":
				this.stop();
				return { stopping: true };
			case "snapshot.get":
				return this.plane.snapshot();
			case "definition.get":
				return this.plane.definition();
			case "operations.get":
				return this.plane.listOperations();
			case "events.get":
				return this.plane.listEvents();
			case "artifacts.get":
				return this.plane.listArtifacts();
			case "diagnostics.get":
				return this.plane.validate();
			case "graph.get":
				return this.plane.graph().toJSON();
			case "plugins.get":
				return this.plane.snapshot().plugins;
			case "completion.get":
				return this.plane.complete(request.input);
			case "command.submit": {
				if (request.command.type === "operation.cancel")
					throw protocolError(
						"command.rejected",
						"Cancellation cannot be submitted asynchronously",
					);
				return this.plane.submit(request.command);
			}
			case "command.execute": {
				if (request.command.type === "operation.cancel") return this.plane.execute(request.command);
				return this.plane.execute(request.command);
			}
			default:
				throw protocolError(
					"request.unsupported",
					`Unsupported workspace request: ${(request as { type: string }).type}`,
				);
		}
	}
}
