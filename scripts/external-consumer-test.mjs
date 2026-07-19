import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTarball } from "./tarball.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("pnpm", ["release:pack"], { cwd: root, stdio: "inherit" });
const fixture = path.join(root, "tests", "fixtures", "external-consumer");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wsrt-packed-consumer-"));
const consumer = path.join(temporaryRoot, "consumer");
const tarballDirectory = path.join(temporaryRoot, "tarballs");
fs.cpSync(fixture, consumer, { recursive: true });
fs.cpSync(path.join(root, ".release", "tarballs"), tarballDirectory, { recursive: true });
const packageFile = path.join(consumer, "package.json");
const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
manifest.devDependencies = {};
for (const file of fs.readdirSync(tarballDirectory).filter((item) => item.endsWith(".tgz"))) {
	const entries = readTarball(path.join(tarballDirectory, file));
	const packed = JSON.parse(entries.get("package/package.json").toString("utf8"));
	manifest.devDependencies[packed.name] = `file:../tarballs/${file}`;
}
fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
try {
	execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock"], {
		cwd: consumer,
		stdio: "inherit",
	});
	const wsrt = path.join(
		consumer,
		"node_modules",
		".bin",
		process.platform === "win32" ? "wsrt.CMD" : "wsrt",
	);
	const run = (...args) =>
		execFileSync(wsrt, args, {
			cwd: consumer,
			stdio: "inherit",
			env: { ...process.env, NO_COLOR: "1" },
		});
	run("--help");
	const installedWsrtManifest = JSON.parse(
		fs.readFileSync(path.join(consumer, "node_modules", "wsrt", "package.json"), "utf8"),
	);
	const reportedVersion = execFileSync(wsrt, ["--version"], {
		cwd: consumer,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	}).trim();
	if (reportedVersion !== installedWsrtManifest.version)
		throw new Error(
			`Packed CLI reported ${reportedVersion}, expected ${installedWsrtManifest.version}`,
		);
	run("validate", "--json");
	run("inspect", "--json");
	run("workspace", "inspect", "--json");
	run("plugins", "--json");
	run("run", "hello", "--json");
	run("exec", "vite", "build");
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			"const api = await import('wsrt'); if (typeof api.defineSystem !== 'function' || typeof api.createControlPlane !== 'function' || new api.NodeRuntimeProvider().id !== 'node') throw new Error('Invalid wsrt public API'); await import('@wsrt/plugin-vite'); await import('@wsrt/plugin-vite/vite'); await import('@wsrt/mcp'); await import('@wsrt/plugins');",
		],
		{ cwd: consumer, stdio: "inherit" },
	);
	if (!fs.existsSync(path.join(consumer, "apps", "web", "dist", "index.html")))
		throw new Error("Packed Vite integration did not produce apps/web/dist/index.html");
	console.log("External packed-package consumer test passed.");
} finally {
	fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
