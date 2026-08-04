import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await rm(resolve(root, "dist"), { recursive: true, force: true });
await run("tsc", ["-p", "tsconfig.json"], root);
await mkdir(resolve(root, "dist/ui"), { recursive: true });
await cp(resolve(root, "src/ui/index.html"), resolve(root, "dist/ui/index.html"));

await esbuild.build({
	entryPoints: [resolve(root, "src/ui/bootstrap.ts"), resolve(root, "src/ui/styles/main.css")],
	outdir: resolve(root, "dist/ui/assets"),
	bundle: true,
	format: "esm",
	target: "es2022",
	splitting: true,
	sourcemap: true,
	minify: true,
	entryNames: "[name]",
	chunkNames: "chunks/[name]-[hash]",
	assetNames: "assets/[name]-[hash]",
	platform: "browser",
	logLevel: "info",
});

function run(command, args, cwd) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, { cwd, stdio: "inherit" });
		child.on("exit", (code) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${command} exited with ${code}`));
		});
		child.on("error", rejectRun);
	});
}
