import {
	ControlPlaneError,
	type SerializedControlPlaneError,
	type SubmittedOperation,
} from "@wsrt/control-plane";
import type {
	DashboardBackend,
	DashboardCancellationResult,
	OperationCancelCommand,
	OperationCreatingCommand,
} from "../backend.js";
import type { DashboardSnapshot } from "../shared/contracts.js";

export type DashboardBackendRequest =
	| { type: "operation.submit"; command: OperationCreatingCommand }
	| { type: "operation.cancel"; command: OperationCancelCommand }
	| { type: "contribution.run"; contributionId: string };

export type DashboardBackendResponse =
	| { type: "operation.submitted"; acknowledgement: SubmittedOperation }
	| { type: "operation.cancelled"; result: DashboardCancellationResult }
	| { type: "contribution.completed"; value: unknown };

export type DashboardBackendOutcome =
	| { type: "success"; response: DashboardBackendResponse }
	| { type: "domain-error"; error: SerializedControlPlaneError };

export interface DashboardWorkerTransport {
	snapshot(): DashboardSnapshot;
	subscribe(listener: (snapshot: DashboardSnapshot) => void): () => void;
	request(request: DashboardBackendRequest): Promise<DashboardBackendOutcome>;
}

export class DashboardTransportError extends Error {
	readonly name = "DashboardTransportError";
	readonly code = "dashboard.transport_failed";
}

export function createWorkerDashboardBackend(
	transport: DashboardWorkerTransport,
): DashboardBackend {
	return {
		snapshot: () => transport.snapshot(),
		subscribe(listener) {
			let revision = -1;
			return transport.subscribe((snapshot) => {
				if (snapshot.revision <= revision) return;
				revision = snapshot.revision;
				listener(snapshot);
			});
		},
		async submit(command) {
			const response = await request(transport, { type: "operation.submit", command });
			if (response.type !== "operation.submitted")
				throw protocolMismatch("operation.submitted", response.type);
			return response.acknowledgement;
		},
		async cancel(command) {
			const response = await request(transport, { type: "operation.cancel", command });
			if (response.type !== "operation.cancelled")
				throw protocolMismatch("operation.cancelled", response.type);
			return response.result;
		},
		async runContribution(contributionId) {
			const response = await request(transport, {
				type: "contribution.run",
				contributionId,
			});
			if (response.type !== "contribution.completed")
				throw protocolMismatch("contribution.completed", response.type);
			return response.value;
		},
	};
}

export async function executeDashboardBackendRequest(
	backend: DashboardBackend,
	request: DashboardBackendRequest,
): Promise<DashboardBackendResponse> {
	switch (request.type) {
		case "operation.submit":
			return {
				type: "operation.submitted",
				acknowledgement: await backend.submit(request.command),
			};
		case "operation.cancel":
			return { type: "operation.cancelled", result: await backend.cancel(request.command) };
		case "contribution.run":
			return {
				type: "contribution.completed",
				value: await backend.runContribution(request.contributionId),
			};
	}
}

async function request(
	transport: DashboardWorkerTransport,
	input: DashboardBackendRequest,
): Promise<DashboardBackendResponse> {
	let outcome: DashboardBackendOutcome;
	try {
		outcome = await transport.request(input);
	} catch (cause) {
		if (cause instanceof DashboardTransportError) throw cause;
		throw new DashboardTransportError(
			cause instanceof Error ? cause.message : "Dashboard worker transport failed",
			{ cause },
		);
	}
	if (outcome.type === "domain-error")
		throw new ControlPlaneError(outcome.error.code, outcome.error.message, outcome.error.details);
	return outcome.response;
}

function protocolMismatch(expected: string, actual: string): DashboardTransportError {
	return new DashboardTransportError(`Dashboard worker returned ${actual}; expected ${expected}`);
}
