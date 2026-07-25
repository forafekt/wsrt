#!/usr/bin/env node
import { createRequire } from "node:module";
import { run } from "@wsrt/cli";

const { version } = createRequire(import.meta.url)("../package.json") as {
	readonly version: string;
};

await (run as (argv: string[], cliVersion: string) => Promise<void>)(process.argv, version);
