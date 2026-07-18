export const RUST_RUNTIME_PROTOCOL_VERSION = 1 as const;

export type SpawnParams = {
	id: string;
	command: string;
	args: string[];
	cwd: string;
	environment: Record<string, string>;
	shell: boolean;
};

export type RustRuntimeRequestMap = {
	ping: undefined;
	spawn: SpawnParams;
	terminate: { id: string; signal?: string };
	connect: { host: string; port: number; timeoutMs: number };
	shutdown: undefined;
};

export type RustRuntimeResultMap = {
	ping: { protocolVersion: number; version: string };
	spawn: { pid: number };
	terminate: { accepted: boolean };
	connect: undefined;
	shutdown: { stopped: boolean };
};

export type RustRuntimeResponse =
	| { type: "response"; id: string; result: unknown }
	| {
			type: "error";
			id: string;
			error: { code: string; message: string; details?: unknown };
	  };

export type RustRuntimeEvent =
	| {
			type: "event";
			event: "output";
			payload: { id: string; stream: "stdout" | "stderr"; data: string };
	  }
	| {
			type: "event";
			event: "exit";
			payload: {
				id: string;
				pid: number;
				code: number | null;
				signal: string | null;
			};
	  };

export type RustRuntimeMessage = RustRuntimeResponse | RustRuntimeEvent;
