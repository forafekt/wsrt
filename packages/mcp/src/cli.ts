#!/usr/bin/env node
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectOrStartWorkspaceSession } from "@wsrt/workspace-session";
import { WsrtMcpServer } from "./server.js";

const value = (name: string) => {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

const client = await connectOrStartWorkspaceSession({
	root: value("--root"),
	config: value("--config"),
});

const server = new WsrtMcpServer(client, {
	allowMutations: process.argv.includes("--allow-mutations"),
});

const close = async () => {
	await server.close().catch(() => {});
	await client.close().catch(() => {});
};

process.once("SIGINT", () => void close());

process.once("SIGTERM", () => void close());

await server.connect(new StdioServerTransport());
