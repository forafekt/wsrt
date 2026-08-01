export function safeSerializable(value: unknown): unknown {
	const seen = new WeakSet<object>();
	return JSON.parse(
		JSON.stringify(value, (key, item) => {
			if (/(?:secret|token|password|private.?key|credential)/i.test(key)) return "[REDACTED]";
			if (typeof item === "function" || typeof item === "symbol") return undefined;
			if (item && typeof item === "object") {
				if (seen.has(item)) return "[CIRCULAR]";
				seen.add(item);
			}
			return item;
		}),
	);
}
