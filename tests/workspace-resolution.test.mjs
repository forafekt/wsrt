import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	projectWorkspace,
	resolveWorkspace,
	syncWorkspace,
} from "../packages/workspace/dist/index.js";

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-workspace-"));
	await fs.writeFile(
		path.join(root, "pnpm-workspace.yaml"),
		"packages:\n  - apps/*\n  - packages/*\n",
	);
	for (const [dir, manifest, source] of [
		[
			"packages/ui",
			{
				name: "@fixture/ui",
				private: false,
				exports: {
					".": { source: "./src/index.ts" },
					"./node": { import: "./dist/node.js" },
				},
			},
			"export const ui = true",
		],
		[
			"apps/web",
			{ name: "@fixture/web", private: true },
			"import { ui } from '@fixture/ui'; console.log(ui)",
		],
	]) {
		await fs.mkdir(path.join(root, dir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(root, dir, "package.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		await fs.writeFile(path.join(root, dir, "src/index.ts"), source);
		if (dir === "packages/ui")
			await fs.writeFile(path.join(root, dir, "src/node.ts"), "export const node = true");
		await fs.writeFile(
			path.join(root, dir, "tsconfig.json"),
			'{"compilerOptions":{"paths":{"user/*":["owned/*"]}}}\n',
		);
	}
	return root;
}
test("workspace discovery resolves pnpm packages, sources, aliases, and inferred edges", async () => {
	const root = await fixture();
	const model = await resolveWorkspace({ root });
	assert.deepEqual(
		model.packages.map((item) => item.name),
		["@fixture/ui", "@fixture/web"],
	);
	assert.equal(model.aliases["@fixture/ui"], path.join(root, "packages/ui/src/index.ts"));
	assert.equal(model.aliases["@fixture/ui/node"], path.join(root, "packages/ui/src/node.ts"));
	assert.deepEqual(model.edges, [{ from: "@fixture/web", to: "@fixture/ui", type: "inferred" }]);
});
test("projections preserve user paths and synchronize idempotently", async () => {
	const root = await fixture();
	const model = await resolveWorkspace({ root });
	const projected = await projectWorkspace(model, {
		manifests: { section: "dependencies" },
	});
	assert.ok(projected.some((item) => item.changed));
	await syncWorkspace(projected, "write");
	const second = await projectWorkspace(await resolveWorkspace({ root }), {
		manifests: { section: "dependencies" },
	});
	assert.equal(
		second.some((item) => item.changed),
		false,
	);
	const tsconfig = JSON.parse(await fs.readFile(path.join(root, "apps/web/tsconfig.json"), "utf8"));
	assert.deepEqual(tsconfig.compilerOptions.paths["user/*"], ["owned/*"]);
	assert.ok(tsconfig.compilerOptions.paths["@fixture/ui"]);
});
test("duplicate package names are diagnosed", async () => {
	const root = await fixture();
	const file = path.join(root, "apps/web/package.json");
	const manifest = JSON.parse(await fs.readFile(file, "utf8"));
	manifest.name = "@fixture/ui";
	await fs.writeFile(file, JSON.stringify(manifest));
	assert.ok(
		(await resolveWorkspace({ root })).diagnostics.some(
			(item) => item.code === "workspace.package_name_duplicate",
		),
	);
});
