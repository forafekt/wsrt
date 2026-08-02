import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeIntegration, setupIntegration } from "../packages/cli/dist/integrations.js";

test("consumer integration setup is managed, idempotent, and reversible", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-integrate-"));
	const client = { getCapabilities: async () => ({ result: [] }) };
	try {
		await fs.writeFile(path.join(root, "AGENTS.md"), "# User instructions\n\nKeep this.\n");
		const first = await setupIntegration(root, "codex", client);
		assert.equal(first.changed, true);
		const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
		assert.match(agents, /Keep this\./);
		assert.match(agents, /wsrt:consumer-reference:start/);
		const consumers = await fs.readFile(path.join(root, ".wsrt", "consumers.md"), "utf8");
		assert.match(consumers, /query the authoritative WSRT workspace protocol/i);
		assert.equal((consumers.match(/wsrt:canonical:start/g) ?? []).length, 1);
		assert.equal((await setupIntegration(root, "codex", client)).changed, false);
		assert.equal((await removeIntegration(root, "codex")).changed, true);
		const removed = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
		assert.match(removed, /Keep this\./);
		assert.doesNotMatch(removed, /wsrt:consumer-reference/);
		assert.equal((await removeIntegration(root, "codex")).changed, false);
		await assert.rejects(setupIntegration(root, "vscode", client), {
			code: "integration.unsupported",
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
