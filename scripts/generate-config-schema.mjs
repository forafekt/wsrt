import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	checkWsrtConfigJsonSchema,
	serializeWsrtConfigJsonSchema,
} from "../packages/config/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = path.join(root, "packages/config/schema/wsrt.schema.json");

if (process.argv.includes("--check")) {
	const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
	if (!checkWsrtConfigJsonSchema(existing).ok)
		throw new Error(`Generated configuration schema is stale: ${file}`);
	console.log(`Configuration schema is current: ${file}`);
} else {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, serializeWsrtConfigJsonSchema());
	console.log(`Generated configuration schema: ${file}`);
}
