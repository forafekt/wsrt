// utils.ts
import type Option from "./option.js";

export const removeBrackets = (v: string) => v.replace(/[<[].+/, "").trim();

export const findAllBrackets = (v: string) => {
	const ANGLED_BRACKET_RE_GLOBAL = /<([^>]+)>/g;
	const SQUARE_BRACKET_RE_GLOBAL = /\[([^\]]+)\]/g;

	const res = [];

	const parse = (match: string[]) => {
		let variadic = false;
		let value = match[1];
		if (value.startsWith("...")) {
			value = value.slice(3);
			variadic = true;
		}
		return {
			required: match[0].startsWith("<"),
			value,
			variadic,
		};
	};

	let angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(v);
	while (angledMatch) {
		res.push(parse(angledMatch));
		angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(v);
	}

	let squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(v);
	while (squareMatch) {
		res.push(parse(squareMatch));
		squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(v);
	}

	return res;
};

interface CmdArgParseOptions {
	alias: {
		[k: string]: string[];
	};
	boolean: string[];
}

export const getArgParseOptions = (options: Option[]) => {
	const result: CmdArgParseOptions = { alias: {}, boolean: [] };

	for (const [index, option] of options.entries()) {
		// We do not set default values in mri options
		// Since its type (typeof) will be used to cast parsed arguments.
		// Which mean `--foo foo` will be parsed as `{foo: true}` if we have `{default:{foo: true}}`

		// Set alias
		if (option.names.length > 1) {
			result.alias[option.names[0]] = option.names.slice(1);
		}
		// Set boolean
		if (option.isBoolean) {
			if (option.negated) {
				// For negated option
				// We only set it to `boolean` type when there's no string-type option with the same name
				const hasStringTypeOption = options.some((o, i) => {
					return (
						i !== index &&
						o.names.some((name) => option.names.includes(name)) &&
						typeof o.required === "boolean"
					);
				});
				if (!hasStringTypeOption) {
					result.boolean.push(option.names[0]);
				}
			} else {
				result.boolean.push(option.names[0]);
			}
		}
	}

	return result;
};

export const findLongest = (arr: string[]) => {
	if (arr.length === 0) return "";
	return arr.sort((a, b) => {
		return a.length > b.length ? -1 : 1;
	})[0];
};

export const padRight = (str: string, length: number) => {
	return str.length >= length ? str : `${str}${" ".repeat(length - str.length)}`;
};

export const camelcase = (input: string) => {
	return input.replace(/([a-z])-([a-z])/g, (_, p1, p2) => {
		return p1 + p2.toUpperCase();
	});
};

export const setDotProp = (obj: { [k: string]: any }, keys: string[], val: any) => {
	let i = 0;
	const length = keys.length;
	let t = obj;
	let x: any;
	for (; i < length; ++i) {
		x = t[keys[i]];
		t = t[keys[i]] =
			i === length - 1
				? val
				: x != null
					? x
					: ~keys[i + 1].indexOf(".") || !(+keys[i + 1] > -1)
						? {}
						: [];
	}
};

export const setByType = (obj: { [k: string]: any }, transforms: { [k: string]: any }) => {
	for (const key of Object.keys(transforms)) {
		const transform = transforms[key];

		if (transform.shouldTransform) {
			obj[key] = Array.prototype.concat.call([], obj[key]);

			if (typeof transform.transformFunction === "function") {
				obj[key] = obj[key].map(transform.transformFunction);
			}
		}
	}
};

export const getFileName = (input: string) => {
	const m = /([^\\/]+)$/.exec(input);
	return m ? m[1] : "";
};

export const camelcaseOptionName = (name: string) => {
	// Camelcase the option name
	// Don't camelcase anything after the dot `.`
	return name
		.split(".")
		.map((v, i) => {
			return i === 0 ? camelcase(v) : v;
		})
		.join(".");
};

export class CommandLineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
		if (typeof Error.captureStackTrace === "function") {
			Error.captureStackTrace(this, this.constructor);
		} else {
			this.stack = new Error(message).stack;
		}
	}
}

export const editDistance = (left: string, right: string): number => {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		let previous = row[0];
		row[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const current = row[j];
			row[j] = Math.min(
				row[j] + 1,
				row[j - 1] + 1,
				previous + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
			previous = current;
		}
	}
	return row[right.length];
};
