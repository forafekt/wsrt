import type { RouteId } from "../core/route.js";
import type { PageContext } from "./page.js";

export async function renderFeature(route: RouteId, context: PageContext): Promise<Node> {
	switch (route) {
		case "overview":
			return (await import("./overview/overview-page.js")).renderOverviewPage(context);
		case "architecture":
			return (await import("./architecture/architecture-page.js")).renderArchitecturePage(context);
		case "projects":
			return (await import("./projects/projects-page.js")).renderProjectsPage(context);
		case "nodes":
			return (await import("./nodes/nodes-page.js")).renderNodesPage(context);
		case "files":
			return (await import("./files/files-page.js")).renderFilesPage(context);
		case "runtime":
			return (await import("./runtime/runtime-page.js")).renderRuntimePage(context);
		case "operations":
			return (await import("./operations/operations-page.js")).renderOperationsPage(context);
		case "diagnostics":
			return (await import("./diagnostics/diagnostics-page.js")).renderDiagnosticsPage(context);
		case "artifacts":
			return (await import("./artifacts/artifacts-page.js")).renderArtifactsPage(context);
		case "impact":
			return (await import("./impact/impact-page.js")).renderImpactPage(context);
		case "validation":
			return (await import("./validation/validation-page.js")).renderValidationPage(context);
		case "sessions":
			return (await import("./sessions/sessions-page.js")).renderSessionsPage(context);
		case "settings":
			return (await import("./settings/settings-page.js")).renderSettingsPage(context);
		default:
			return (await import("./not-found/not-found-page.js")).renderNotFoundPage(context);
	}
}
