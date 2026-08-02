export {
	dashboardCancelOperation,
	dashboardOperation,
	dashboardSnapshot,
	safeSerializable,
} from "./api.js";

export {
	createDirectDashboardBackend,
	createSessionDashboardBackend,
	type DashboardBackend,
	type DashboardCancellationResult,
	type OperationCancelCommand,
	type OperationCreatingCommand,
} from "./backend.js";

export { loadLayout, WorkbenchLayout } from "./client/layout.js";

export { matchDashboardRoute } from "./client/router.js";

export { DashboardStore, reduceDashboardState } from "./client/state/store.js";

export { SnapshotTransport } from "./client/transport/sse.js";

export {
	type DashboardOptions,
	dashboardPlugin,
	dashboardPlugin as default,
	normalizeDashboardOptions,
} from "./plugin/index.js";

export {
	createDashboardServer,
	type DashboardHandle,
	startDashboard,
	streamSnapshots,
} from "./server/index.js";

export {
	createWorkerDashboardBackend,
	DashboardTransportError,
	type DashboardWorkerTransport,
} from "./server/worker-backend.js";

export { DASHBOARD_PROTOCOL } from "./shared/contracts.js";

export {
	validateDashboardContribution,
	validateDashboardContributions,
} from "./shared/contributions.js";
