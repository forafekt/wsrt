#!/usr/bin/env node
import process from "node:process";
import { createControlPlane } from "@wsrt/control-plane";

const args = process.argv.slice(2),
	command = args.shift() ?? "inspect";
let root: string | undefined,
	config: string | undefined,
	json = false;
const values: string[] = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--root") root = args[++i];
	else if (args[i] === "--config") config = args[++i];
	else if (args[i] === "--json") json = true;
	else values.push(args[i]);
}
const plane = await createControlPlane({ root, config });
try {
	let result: unknown;
	switch (command) {
		case "validate":
			result = plane.validate();
			break;
		case "inspect":
			result = {
				definition: plane.definition(),
				nodes: plane.graph().nodes(),
				diagnostics: plane.validate(),
			};
			break;
		case "graph":
			result = plane.graph().toJSON();
			break;
		case "up":
			result = await plane.start();
			break;
		case "down":
			result = await plane.stop();
			break;
		case "start":
			result = await plane.start(values);
			break;
		case "stop":
			result = await plane.stop(values);
			break;
		case "restart":
			result = await plane.restart(values);
			break;
		case "run":
			if (!values[0]) throw new Error("Usage: wsrt run <task>");
			result = await plane.runTask(values[0]);
			break;
		case "artifacts":
			result = plane.listArtifacts();
			break;
		default:
			throw new Error(`Unknown command: ${command}`);
	}
	console.log(JSON.stringify(result, null, json ? 2 : 0));
	if (
		["up", "start", "restart"].includes(command) &&
		plane.definition().executables.some((item) => item.kind !== "task")
	)
		await new Promise<void>((resolve) => {
			const close = async () => {
				await plane.dispose();
				resolve();
			};
			process.once("SIGINT", close);
			process.once("SIGTERM", close);
		});
} finally {
	if (!["up", "start", "restart"].includes(command)) await plane.dispose();
}
