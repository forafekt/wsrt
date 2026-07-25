import fs from "node:fs";
import zlib from "node:zlib";

export function readTarball(file) {
	const tar = zlib.gunzipSync(fs.readFileSync(file));
	const entries = new Map();
	for (let offset = 0; offset + 512 <= tar.length; ) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const text = (start, length) =>
			header
				.subarray(start, start + length)
				.toString("utf8")
				.replace(/\0.*$/s, "");
		const name = `${text(345, 155)}${text(345, 155) ? "/" : ""}${text(0, 100)}`;
		const size = Number.parseInt(text(124, 12).trim() || "0", 8);
		offset += 512;
		entries.set(name, tar.subarray(offset, offset + size));
		offset += Math.ceil(size / 512) * 512;
	}
	return entries;
}
