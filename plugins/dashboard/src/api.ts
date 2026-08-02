import type {
	DashboardBackend,
	OperationCancelCommand,
	OperationCreatingCommand,
} from "./backend.js";

export { safeSerializable } from "./serialization.js";

export function dashboardSnapshot(backend: DashboardBackend) {
	return backend.snapshot();
}

export function dashboardOperation(backend: DashboardBackend, command: OperationCreatingCommand) {
	return backend.submit(command);
}

export function dashboardCancelOperation(
	backend: DashboardBackend,
	command: OperationCancelCommand,
) {
	return backend.cancel(command);
}
