import type { ResolvedWorkspace, WorkspaceResolveOptions } from "@wsrt/workspace";

export type AliasPrecedence = "user" | "wsrt";

export type VitePluginOptions = {
	workspace?: Omit<WorkspaceResolveOptions, "root"> & {
		discover?: boolean;
		root?: string;
	};
	aliasPrecedence?: AliasPrecedence;
	project?: string;
};

export type ViteAdapterOptions = {
	root?: string;
	command?: "dev" | "build" | "preview";
	args?: readonly string[];
	configFile?: string;
	host?: string;
	port?: number;
	strictPort?: boolean;
};

export type ViteBridge = {
	workspaceRoot: string;
	projectRoot: string;
	nodeId?: string;
	aliases: Readonly<Record<string, string>>;
	workspace: ResolvedWorkspace;
	environment: Readonly<Record<string, string>>;
};
