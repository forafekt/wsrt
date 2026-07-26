import type { DashboardContributionView } from "./contracts.js";

const kinds = new Set<DashboardContributionView["kind"]>([
	"page",
	"widget",
	"panel",
	"action",
	"command",
	"inspector",
	"badge",
	"graph-decoration",
	"diagnostic-renderer",
	"artifact-action",
	"operation-action",
	"event-renderer",
	"metric-panel",
	"status-item",
	"navigation",
]);

const idPattern = /^[a-z0-9][a-z0-9._:/-]{0,127}$/i;

export function validateDashboardContribution(value: unknown): {
	value?: DashboardContributionView;
	error?: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { error: "Contribution must be an object" };
	const input = value as Record<string, unknown>;
	if (typeof input.id !== "string" || !idPattern.test(input.id))
		return { error: "Contribution id is invalid" };
	if (typeof input.kind !== "string" || !kinds.has(input.kind as DashboardContributionView["kind"]))
		return { error: `Unsupported contribution kind: ${String(input.kind)}` };
	for (const field of ["title", "description", "target", "group"] as const)
		if (input[field] !== undefined && typeof input[field] !== "string")
			return { error: `${field} must be a string` };
	if (
		input.order !== undefined &&
		(!Number.isFinite(input.order) || typeof input.order !== "number")
	)
		return { error: "order must be a finite number" };
	if (input.refreshMs !== undefined) {
		if (
			typeof input.refreshMs !== "number" ||
			!Number.isInteger(input.refreshMs) ||
			input.refreshMs < 250 ||
			input.refreshMs > 3_600_000
		)
			return { error: "refreshMs must be between 250 and 3600000" };
	}
	if (input.mutation !== undefined && typeof input.mutation !== "boolean")
		return { error: "mutation must be a boolean" };
	try {
		const encoded = JSON.stringify(input.data);
		if (encoded && encoded.length > 1_000_000)
			return { error: "Contribution data exceeds the 1 MB limit" };
	} catch {
		return { error: "Contribution data must be serializable" };
	}
	const output: DashboardContributionView = {
		id: input.id,
		kind: input.kind as DashboardContributionView["kind"],
		...(typeof input.title === "string" && { title: input.title }),
		...(typeof input.description === "string" && { description: input.description }),
		...(typeof input.target === "string" && { target: input.target }),
		...(typeof input.group === "string" && { group: input.group }),
		...(typeof input.order === "number" && { order: input.order }),
		...(typeof input.refreshMs === "number" && { refreshMs: input.refreshMs }),
		...(typeof input.mutation === "boolean" && { mutation: input.mutation }),
		...("data" in input && { data: input.data }),
		...(typeof input.error === "string" && { error: input.error }),
	};
	return { value: Object.freeze(output) };
}

export function validateDashboardContributions(
	values: readonly unknown[],
): readonly DashboardContributionView[] {
	const seen = new Set<string>();
	return Object.freeze(
		values.map((input, index) => {
			const result = validateDashboardContribution(input);
			const raw = input as Record<string, unknown> | undefined;
			const id = typeof raw?.id === "string" ? raw.id : `invalid-${index + 1}`;
			if (!result.value)
				return Object.freeze({
					id,
					kind: "panel" as const,
					title: id,
					error: result.error ?? "Invalid contribution",
				});
			const key = `${result.value.kind}:${result.value.id}`;
			if (seen.has(key))
				return Object.freeze({ ...result.value, error: `Duplicate contribution ${key}` });
			seen.add(key);
			return result.value;
		}),
	);
}
