// #!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import process from "node:process";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

const IGNORED_DIRECTORIES = new Set([
	".git",
	".turbo",
	".wsrt",
	"build",
	"coverage",
	"dist",
	"node_modules",
]);

function parseArguments(argv) {
	let mode = "write";
	let includeImports = false;
	const paths = [];

	for (const argument of argv) {
		switch (argument) {
			case "--check":
				mode = "check";
				break;

			case "--write":
				mode = "write";
				break;

			case "--include-imports":
				includeImports = true;
				break;

			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
				break;

			default:
				if (argument.startsWith("-")) {
					throw new Error(`Unknown option: ${argument}`);
				}

				paths.push(argument);
		}
	}

	return {
		mode,
		includeImports,
		paths: paths.length > 0 ? paths : ["."],
	};
}

function printHelp() {
	console.log(`top-level-spacing [options] [paths...]

Ensures one empty line between top-level JavaScript/TypeScript statements.

Options:
  --write             Update files in place (default)
  --check             Report files that need changes and exit with code 1
  --include-imports   Also place empty lines between individual imports
  -h, --help          Show this help
`);
}

function isSourceFile(path) {
	return SOURCE_EXTENSIONS.has(extname(path));
}

async function collectFiles(inputPath) {
	const absolutePath = resolve(inputPath);
	const metadata = await stat(absolutePath);

	if (metadata.isFile()) {
		return isSourceFile(absolutePath) ? [absolutePath] : [];
	}

	if (!metadata.isDirectory()) {
		return [];
	}

	const entries = await readdir(absolutePath, {
		withFileTypes: true,
	});

	const files = [];

	for (const entry of entries) {
		if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
			continue;
		}

		const entryPath = resolve(absolutePath, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await collectFiles(entryPath)));
		} else if (entry.isFile() && isSourceFile(entryPath)) {
			files.push(entryPath);
		}
	}

	return files;
}

function getScriptKind(filePath) {
	switch (extname(filePath)) {
		case ".tsx":
			return ts.ScriptKind.TSX;

		case ".jsx":
			return ts.ScriptKind.JSX;

		case ".js":
		case ".mjs":
		case ".cjs":
			return ts.ScriptKind.JS;

		default:
			return ts.ScriptKind.TS;
	}
}

function isImportLike(statement) {
	return ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement);
}

function isDirective(statement) {
	return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
}

function countLineBreaks(text) {
	return (text.match(/\r\n|\r|\n/g) ?? []).length;
}

function preferredLineEnding(text) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

function formatSource(filePath, sourceText, includeImports) {
	const sourceFile = ts.createSourceFile(
		filePath,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath),
	);

	if (sourceFile.statements.length < 2) {
		return sourceText;
	}

	const lineEnding = preferredLineEnding(sourceText);
	const insertions = [];

	for (let index = 1; index < sourceFile.statements.length; index += 1) {
		const previous = sourceFile.statements[index - 1];
		const current = sourceFile.statements[index];

		// Keep import blocks and directive prologues compact unless explicitly requested.
		if (
			!includeImports &&
			((isImportLike(previous) && isImportLike(current)) ||
				(isDirective(previous) && isDirective(current)))
		) {
			continue;
		}

		const boundary = current.getFullStart();
		const gap = sourceText.slice(previous.end, boundary);

		// A blank line means at least two line breaks between the statements.
		if (countLineBreaks(gap) >= 2) {
			continue;
		}

		// Insert before the current statement's leading comments/trivia so comments
		// remain visually attached to the declaration that follows them.
		insertions.push(boundary);
	}

	if (insertions.length === 0) {
		return sourceText;
	}

	let output = sourceText;

	for (const position of insertions.sort((a, b) => b - a)) {
		output = output.slice(0, position) + lineEnding + output.slice(position);
	}

	return output;
}

async function processFile(filePath, options) {
	const original = await readFile(filePath, "utf8");

	const formatted = formatSource(filePath, original, options.includeImports);

	if (formatted === original) {
		return false;
	}

	if (options.mode === "write") {
		await writeFile(filePath, formatted, "utf8");
		console.log(`formatted ${filePath}`);
	} else {
		console.error(`needs spacing ${filePath}`);
	}

	return true;
}

async function main() {
	const options = parseArguments(process.argv.slice(2));

	const fileGroups = await Promise.all(options.paths.map(collectFiles));

	const files = [...new Set(fileGroups.flat())].sort();

	let changedCount = 0;

	for (const filePath of files) {
		if (await processFile(filePath, options)) {
			changedCount += 1;
		}
	}

	if (options.mode === "check" && changedCount > 0) {
		console.error(
			`\n${changedCount} file${changedCount === 1 ? "" : "s"} require top-level spacing.`,
		);

		process.exitCode = 1;
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);

	console.error(`top-level-spacing: ${message}`);
	process.exitCode = 1;
});
