import { existsSync } from "@wsrt/x/std/fs.ts";
import { dirname, join } from "@wsrt/x/std/path.ts";
import { autocomplete } from "./autocomplete.ts";
import type { CommonOptions } from "./common.ts";

export interface PathOptions extends CommonOptions {
	root?: string;
	directory?: boolean;
	initialValue?: string;
	message: string;
	validate?: (value: string | undefined) => string | Error | undefined;
}

export const path = (opts: PathOptions) => {
	const validate = opts.validate;

	return autocomplete({
		...opts,
		initialUserInput: opts.initialValue ?? opts.root ?? Deno.cwd(),
		maxItems: 5,
		validate(value) {
			if (Array.isArray(value)) {
				// Shouldn't ever happen since we don't enable `multiple: true`
				return undefined;
			}
			if (!value) {
				return "Please select a path";
			}
			if (validate) {
				return validate(value);
			}
			return undefined;
		},
		options() {
			const userInput = this.userInput;
			if (userInput === "") {
				return [];
			}

			try {
				let searchPath: string;

				if (!existsSync(userInput)) {
					searchPath = dirname(userInput);
				} else {
					const stat = Deno.statSync(userInput);
					if (stat.isDirectory) {
						searchPath = userInput;
					} else {
						searchPath = dirname(userInput);
					}
				}

				const items = Deno.readDirSync(searchPath)
					.map((item) => {
						const path = join(searchPath, item.name);
						const stats = Deno.statSync(path);
						return {
							name: item,
							path,
							isDirectory: stats.isDirectory,
						};
					})
					.filter(
						({ path, isDirectory }) =>
							path.startsWith(userInput) && (opts.directory || !isDirectory),
					);
				return items.map((item) => ({
					value: item.path,
				}));
			} catch (_e) {
				return [] as any;
			}
		},
	});
};
