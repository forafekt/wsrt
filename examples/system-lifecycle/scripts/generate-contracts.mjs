import { mkdir, writeFile } from "node:fs/promises";

await mkdir("generated", { recursive: true });

await writeFile("generated/api-client.ts", 'export const apiVersion = "1"\n');
