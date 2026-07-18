import type { Alias, AliasOptions } from "vite";
import type { AliasPrecedence } from "./types.js";

export function workspaceAliasEntries(
	aliases: Readonly<Record<string, string>>,
): Alias[] {
	return Object.entries(aliases)
		.sort(([a], [b]) => b.length - a.length)
		.map(([find, replacement]) => ({ find: exact(find), replacement }));
}
export function mergeAliases(
	user: AliasOptions | undefined,
	workspace: Readonly<Record<string, string>>,
	precedence: AliasPrecedence = "user",
): Alias[] {
	const generated = workspaceAliasEntries(workspace);
	const entries: Alias[] = Array.isArray(user)
		? [...user]
		: Object.entries(user ?? {}).map(([find, replacement]) => ({
				find,
				replacement,
			}));
	const names = new Set(
		entries.map((item) =>
			typeof item.find === "string" ? item.find : item.find.source,
		),
	);
	if (precedence === "user")
		return [
			...entries,
			...generated.filter(
				(item) =>
					!names.has(
						(item.find as RegExp).source.slice(1, -1).replace(/\\/g, ""),
					),
			),
		];
	const generatedNames = new Set(Object.keys(workspace));
	return [
		...generated,
		...entries.filter(
			(item) =>
				!generatedNames.has(
					typeof item.find === "string" ? item.find : item.find.source,
				),
		),
	];
}
function exact(value: string): RegExp {
	return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
