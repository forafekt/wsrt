export function fromDenoEnv() {
	if (typeof Deno === "undefined") {
		throw new Error("Deno is not available in this environment.");
	}
	return () => Deno.env.toObject();
}

let Deno: any;

let global: any;

if (typeof (globalThis as any).Deno !== "undefined") {
	Deno = (globalThis as any).Deno;
} else if (typeof window !== "undefined" && typeof (window as any).Deno !== "undefined") {
	Deno = (window as any).Deno;
} else if (typeof global !== "undefined" && typeof (global as any).Deno !== "undefined") {
	Deno = (global as any).Deno;
}
