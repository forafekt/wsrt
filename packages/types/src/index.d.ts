import type { ChildProcess } from 'node:child_process';
import type { InlineConfig, Plugin, UserConfig } from 'vite';
export type AdapterName = 'vite' | 'node' | 'command' | 'composite' | (string & {});
export type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';
export type RuntimeProfile = {
    environment: RuntimeEnvironment;
    name: string;
};
export type DiagnosticLevel = 'info' | 'warning' | 'error';
export type WsrtDiagnostic = {
    code: string;
    level: DiagnosticLevel;
    message: string;
    source?: string;
    project?: string;
    detail?: unknown;
};
export type SyncMode = 'check' | 'write';
export type TsconfigSyncConfig = {
    enabled?: boolean;
    mode?: SyncMode;
    projects?: boolean;
    root?: boolean;
    paths?: boolean;
};
export type ManifestTarget = 'package-json' | 'extension' | 'wsrt';
export type ManifestSyncConfig = {
    enabled?: boolean;
    mode?: SyncMode;
    targets?: ManifestTarget[];
    manifestNames?: string[];
    wsrtManifestName?: string;
};
export type SyncStatus = 'synced' | 'drifted' | 'written' | 'missing' | 'error' | 'skipped';
export type SyncFileStatus = {
    file: string;
    target: string;
    status: SyncStatus;
    message?: string;
    diagnostics: WsrtDiagnostic[];
};
export type RuntimeArtifact = {
    id: string;
    file: string;
    kind: 'report' | 'graph' | 'packages' | 'aliases' | 'diagnostics' | 'virtual' | 'manifest';
    status: 'planned' | 'written' | 'error';
    bytes?: number;
    message?: string;
};
export type RuntimeEventMap = {
    'runtime:created': {
        runtime: WorkspaceRuntime;
    };
    'runtime:started': {
        runtime: WorkspaceRuntime;
    };
    'runtime:stopped': {
        runtime: WorkspaceRuntime;
    };
    'config:loaded': {
        root: string;
        configFile?: string;
    };
    'project:discovered': {
        project: RuntimeProject;
    };
    'package:discovered': {
        package: WorkspacePackage;
    };
    'graph:updated': {
        graph: WorkspaceGraph;
    };
    'service:registered': {
        service: RuntimeService;
    };
    'service:starting': {
        service: RuntimeService;
    };
    'service:started': {
        service: RuntimeService;
        handle?: ProjectHandle;
    };
    'service:failed': {
        service: RuntimeService;
        error: string;
    };
    'service:stopping': {
        service: RuntimeService;
    };
    'service:stopped': {
        service: RuntimeService;
    };
    'service:health': {
        service: RuntimeService;
        health: ServiceHealth;
    };
    'diagnostic:added': {
        diagnostic: WsrtDiagnostic;
    };
    'artifacts:generated': {
        artifacts: RuntimeArtifact[];
    };
    'task:started': {
        task: RuntimeTaskDefinition;
    };
    'task:completed': {
        task: RuntimeTaskDefinition;
        result: unknown;
    };
    'task:failed': {
        task: RuntimeTaskDefinition;
        error: string;
    };
    'command:started': {
        command: RuntimeCommandDefinition;
        args: string[];
    };
    'command:completed': {
        command: RuntimeCommandDefinition;
        result: unknown;
    };
    'command:failed': {
        command: RuntimeCommandDefinition;
        error: string;
    };
    'dashboard:action': {
        action: string;
        id?: string;
        status?: 'ok' | 'unsupported' | 'failed';
    };
    'plugin:data-updated': {
        plugin: string;
        key: string;
        data: unknown;
    };
    'git:repository-detected': {
        root: string;
        branch?: string;
    };
    'git:status-refreshed': {
        root: string;
        changed: number;
        staged: number;
        untracked: number;
    };
    'typescript:tsconfig-discovered': {
        file: string;
    };
    'typescript:state-refreshed': {
        root: string;
        tsconfigs: number;
        diagnostics: number;
    };
    'typescript:typecheck-started': {
        root: string;
    };
    'typescript:typecheck-completed': {
        root: string;
        exitCode: number | null;
    };
    'typescript:typecheck-failed': {
        root: string;
        error: string;
    };
    'workspace:package-manager-detected': {
        root: string;
        packageManager?: string;
    };
    'workspace:package-discovered': {
        name: string;
        root: string;
    };
    'workspace:graph-updated': {
        packages: number;
        edges: number;
    };
};
export type RuntimeEventName = keyof RuntimeEventMap;
export type RuntimeEventBus = {
    on: <Name extends RuntimeEventName>(name: Name, listener: (event: RuntimeEventMap[Name]) => void) => () => void;
    once: <Name extends RuntimeEventName>(name: Name, listener: (event: RuntimeEventMap[Name]) => void) => () => void;
    emit: <Name extends RuntimeEventName>(name: Name, event: RuntimeEventMap[Name]) => void;
};
export type RuntimeTimelineEntry = {
    id: number;
    timestamp: string;
    name: RuntimeEventName;
    summary: string;
    detail?: unknown;
};
export type RuntimeTimeline = {
    record: <Name extends RuntimeEventName>(name: Name, event: RuntimeEventMap[Name]) => RuntimeTimelineEntry;
    list: () => RuntimeTimelineEntry[];
    recent: (limit?: number) => RuntimeTimelineEntry[];
    clear: () => void;
};
export type ServiceKind = 'dev-server' | 'api' | 'worker' | 'electron' | 'job' | 'registry' | 'mcp' | 'dashboard' | 'custom';
export type ServiceLifecycleState = 'registered' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export type ServiceHealth = {
    status: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
    checkedAt: string;
    message?: string;
    detail?: unknown;
};
export type ServiceLogEntry = {
    timestamp: string;
    level: DiagnosticLevel;
    message: string;
    detail?: unknown;
};
export type ServiceMetric = {
    name: string;
    value: number;
    unit?: string;
    tags?: Record<string, string>;
};
export type RuntimeServiceDefinition = {
    id: string;
    name?: string;
    kind: ServiceKind;
    project?: string;
    adapter?: AdapterName;
    root?: string;
    command?: string;
    environment?: WsrtEnvironment;
    url?: string;
    metadata?: Record<string, unknown>;
    start?: () => Promise<ProjectHandle | undefined> | ProjectHandle | undefined;
    stop?: () => Promise<void> | void;
    health?: () => Promise<ServiceHealth> | ServiceHealth;
    logs?: () => Promise<ServiceLogEntry[]> | ServiceLogEntry[];
    metrics?: () => Promise<ServiceMetric[]> | ServiceMetric[];
};
export type RuntimeService = Omit<RuntimeServiceDefinition, 'start' | 'stop' | 'health' | 'logs' | 'metrics' | 'environment'> & {
    name: string;
    environment?: RuntimeResolvedEnvironment;
    state: ServiceLifecycleState;
    health: ServiceHealth;
    logs: ServiceLogEntry[];
    metrics: ServiceMetric[];
    handle?: ProjectHandle;
    error?: string;
};
export type RuntimeServiceRegistry = {
    register: (definition: RuntimeServiceDefinition) => RuntimeService;
    list: () => RuntimeService[];
    get: (id: string) => RuntimeService | undefined;
    start: (id: string) => Promise<RuntimeService>;
    stop: (id: string) => Promise<RuntimeService>;
    restart: (id: string) => Promise<RuntimeService>;
    health: (id?: string) => Promise<ServiceHealth | Record<string, ServiceHealth>>;
    logs: (id: string) => Promise<ServiceLogEntry[]>;
    metrics: (id: string) => Promise<ServiceMetric[]>;
};
export type VirtualImport = {
    id: string;
    kind: 'vite' | 'fallback';
    contents: string;
    file?: string;
};
export type VirtualImportState = {
    imports: VirtualImport[];
    fallbackDir: string;
    diagnostics: WsrtDiagnostic[];
};
export type McpEntry = {
    id: string;
    title: string;
    description: string;
    kind: 'tool' | 'resource';
};
export type McpRuntimeState = {
    enabled: boolean;
    name?: string;
    exposeSourcePaths: boolean;
    exposeReports: boolean;
    exposeDiagnostics: boolean;
    maxResults: number;
    tools: McpEntry[];
    resources: McpEntry[];
};
export type DashboardRoute = {
    id: string;
    label: string;
    path: string;
};
export type RuntimeOverview = {
    root: string;
    profile: RuntimeProfile;
    configFile?: string;
    counts: {
        projects: number;
        packages: number;
        services: number;
        runningServices: number;
        diagnostics: number;
        errors: number;
        warnings: number;
        artifacts: number;
        events: number;
        tasks: number;
        commandGroups: number;
    };
};
export type RuntimeQuery = {
    overview: () => RuntimeOverview;
    projects: () => RuntimeProject[];
    packages: (query?: {
        search?: string;
        limit?: number;
    }) => WorkspacePackage[];
    services: () => RuntimeService[];
    graph: (query?: RuntimeGraphQuery) => {
        nodes: RuntimeGraphNode[];
        edges: RuntimeGraphEdge[];
    };
    diagnostics: (query?: {
        level?: DiagnosticLevel;
        limit?: number;
    }) => WsrtDiagnostic[];
    artifacts: () => RuntimeArtifact[];
    events: (query?: {
        name?: RuntimeEventName;
        limit?: number;
    }) => RuntimeTimelineEntry[];
    timeline: (limit?: number) => RuntimeTimelineEntry[];
    config: () => {
        root: string;
        configFile?: string;
        sources: ConfigSource[];
        config: WsrtConfig;
    };
    tasks: () => RuntimeTaskDefinition[];
    cli: () => RuntimeCliGroupDefinition[];
    plugin: (id: string) => unknown;
    plugins: () => WsrtPluginMetadata[];
    pluginsData: () => Record<string, unknown>;
};
export type RuntimeTaskContext = {
    runtime: WorkspaceRuntime;
    args: string[];
    input?: unknown;
};
export type RuntimeTaskDefinition = {
    id: string;
    title: string;
    description?: string;
    run: (context: RuntimeTaskContext) => Promise<unknown> | unknown;
};
export type RuntimeTaskRegistry = {
    register: (definition: RuntimeTaskDefinition) => RuntimeTaskDefinition;
    list: () => RuntimeTaskDefinition[];
    get: (id: string) => RuntimeTaskDefinition | undefined;
    run: (id: string, context?: {
        args?: string[];
        input?: unknown;
    }) => Promise<unknown>;
};
export type RuntimeCommandContext = {
    runtime: WorkspaceRuntime;
    args: string[];
    input?: unknown;
};
export type RuntimeCommandDefinition = {
    id: string;
    title: string;
    description?: string;
    run: (context: RuntimeCommandContext) => Promise<unknown> | unknown;
};
export type RuntimeCommandRegistry = {
    register: (definition: RuntimeCommandDefinition) => RuntimeCommandDefinition;
    list: () => RuntimeCommandDefinition[];
    get: (id: string) => RuntimeCommandDefinition | undefined;
    run: (id: string, context?: {
        args?: string[];
        input?: unknown;
    }) => Promise<unknown>;
};
export type RuntimeCliInvocation = {
    runtime: WorkspaceRuntime;
    args: string[];
    options: Record<string, unknown>;
};
export type RuntimeCliGroupDefinition = {
    id: string;
    title?: string;
    description?: string;
    aliases?: string[];
    run: (invocation: RuntimeCliInvocation) => Promise<unknown> | unknown;
};
export type RuntimeCliRegistry = {
    registerGroup: (definition: RuntimeCliGroupDefinition) => RuntimeCliGroupDefinition;
    listGroups: () => RuntimeCliGroupDefinition[];
    getGroup: (id: string) => RuntimeCliGroupDefinition | undefined;
    run: (id: string, invocation: Omit<RuntimeCliInvocation, 'runtime'>) => Promise<unknown>;
};
export type WsrtPluginContext = {
    runtime: WorkspaceRuntime;
};
export type WsrtPlugin = {
    name: string;
    metadata?: Partial<WsrtPluginMetadata>;
    config?: (config: WsrtConfig) => WsrtConfig | undefined | Promise<WsrtConfig | undefined>;
    configResolved?: (config: WsrtConfig, context: WsrtPluginContext) => void | Promise<void>;
    runtimeCreated?: (context: WsrtPluginContext) => void | Promise<void>;
    packagesDiscovered?: (packages: WorkspacePackage[], context: WsrtPluginContext) => void | Promise<void>;
    aliasesResolved?: (aliases: Record<string, string>, context: WsrtPluginContext) => void | Promise<void>;
    graphBuilt?: (graph: WorkspaceGraph, context: WsrtPluginContext) => void | Promise<void>;
    diagnostics?: (diagnostics: WsrtDiagnostic[], context: WsrtPluginContext) => void | Promise<void>;
    beforeDev?: (context: WsrtPluginContext & {
        project?: RuntimeProject;
    }) => void | Promise<void>;
    afterDev?: (context: WsrtPluginContext & {
        project?: RuntimeProject;
        handle?: ProjectHandle;
    }) => void | Promise<void>;
    adapterCreated?: (context: WsrtPluginContext & {
        adapter: ProjectAdapter;
    }) => void | Promise<void>;
    projectStarted?: (context: WsrtPluginContext & {
        project: RuntimeProject;
        handle: ProjectHandle;
    }) => void | Promise<void>;
    projectStopped?: (context: WsrtPluginContext & {
        project: RuntimeProject;
        handle: ProjectHandle;
    }) => void | Promise<void>;
    artifactsGenerated?: (artifacts: RuntimeArtifact[], context: WsrtPluginContext) => void | Promise<void>;
    dashboardRoutes?: (routes: DashboardRoute[], context: WsrtPluginContext) => void | Promise<void>;
    dashboardPages?: (pages: DashboardPluginPage[], context: WsrtPluginContext) => void | Promise<void>;
    mcpTools?: (entries: McpEntry[], context: WsrtPluginContext) => void | Promise<void>;
};
export type WsrtPluginMetadata = {
    name: string;
    version?: string;
    description?: string;
    homepage?: string;
    repository?: string;
    capabilities?: string[];
};
export type WsrtModuleReference = string | {
    path?: string;
    package?: string;
    url?: string;
    export?: string;
    options?: Record<string, unknown>;
};
export type WsrtModuleReferenceContext = {
    source: string;
    baseDir: string;
    field: string;
    diagnostics: WsrtDiagnostic[];
};
export type WsrtModuleResolvable<T> = T | WsrtModuleReference;
export type DashboardPluginPageWidget = {
    kind: 'metric';
    label: string;
    value: unknown;
    tone?: 'neutral' | 'ok' | 'warning' | 'error';
} | {
    kind: 'key-values';
    title: string;
    values: Record<string, unknown>;
} | {
    kind: 'table';
    title: string;
    headers: string[];
    rows: unknown[][];
} | {
    kind: 'badges';
    title: string;
    values: unknown[];
} | {
    kind: 'actions';
    title: string;
    actions: Array<{
        label: string;
        action: string;
        id?: string;
        value?: string;
        disabled?: boolean;
    }>;
} | {
    kind: 'json';
    title: string;
    data: unknown;
};
export type DashboardPluginPage = {
    id: string;
    title: string;
    subtitle?: string;
    plugin: string;
    widgets: DashboardPluginPageWidget[];
};
export type ConfigSource = {
    file: string;
    kind: 'root' | 'extends';
};
export type ServerConfig = {
    host?: string;
    port?: number;
    strictPort?: boolean;
    open?: boolean;
};
export type WsrtEnvironmentValue = string | number | boolean | null | undefined;
export type WsrtEnvironment = Record<string, WsrtEnvironmentValue>;
export type RuntimeEnvironmentEntry = {
    key: string;
    value?: string;
    masked: boolean;
    omitted?: boolean;
    sensitive: boolean;
};
export type RuntimeResolvedEnvironment = {
    values: Record<string, string>;
    entries: RuntimeEnvironmentEntry[];
};
export type ViteProjectConfig = {
    configFile?: string | false;
    mode?: string;
    command?: 'serve' | 'build' | 'build-watch';
};
export type ProjectProcessConfig = Omit<ProjectConfig, 'processes'> & {
    name?: string;
};
export type ProjectConfig = {
    root?: string;
    adapter?: AdapterName;
    command?: string;
    environment?: WsrtEnvironment;
    vite?: ViteProjectConfig;
    server?: ServerConfig;
    dependsOn?: string[];
    processes?: Record<string, ProjectProcessConfig> | ProjectProcessConfig[];
};
export type WsrtConfig = {
    extends?: string | string[];
    root?: string;
    workspace?: {
        packages?: string[];
    };
    projects?: Record<string, ProjectConfig>;
    resolve?: Record<string, unknown>;
    extraAliases?: Record<string, string>;
    packageDefaults?: Record<string, unknown>;
    packageConfigOverrides?: Record<string, Record<string, unknown>>;
    imports?: Record<string, unknown>;
    graph?: {
        includeExternal?: boolean;
    };
    analyze?: Record<string, unknown>;
    diagnostics?: {
        path?: string;
    };
    server?: ServerConfig;
    dashboard?: boolean | (ServerConfig & {
        enabled?: boolean;
        path?: string;
    });
    artifacts?: {
        dir?: string;
        report?: boolean;
        graph?: boolean;
        packages?: boolean;
        aliases?: boolean;
        diagnostics?: boolean;
    };
    mcp?: false | {
        enabled?: boolean;
        name?: string;
        exposeSourcePaths?: boolean;
        exposeReports?: boolean;
        exposeDiagnostics?: boolean;
        maxResults?: number;
        [key: string]: unknown;
    };
    runtime?: {
        environment?: RuntimeEnvironment;
        profile?: string;
    };
    environments?: Record<string, WsrtConfig>;
    profiles?: Record<string, WsrtConfig>;
    tsconfig?: TsconfigSyncConfig;
    manifests?: ManifestSyncConfig;
    plugins?: Array<WsrtModuleResolvable<WsrtPlugin>>;
    adapters?: Array<WsrtModuleResolvable<ProjectAdapter>>;
    tasks?: Array<WsrtModuleResolvable<RuntimeTaskDefinition>>;
    services?: Array<WsrtModuleResolvable<RuntimeServiceDefinition>>;
    actions?: Array<WsrtModuleResolvable<RuntimeCommandDefinition>>;
    hooks?: Array<WsrtModuleReference | Record<string, unknown>>;
    generators?: Array<WsrtModuleReference | Record<string, unknown>>;
    validators?: Array<WsrtModuleReference | Record<string, unknown>>;
    report?: {
        file?: string;
        pretty?: boolean;
    };
};
export type WorkspaceRuntimeOptions = {
    root?: string;
    config?: string;
    inlineConfig?: WsrtConfig;
    adapters?: ProjectAdapter[];
};
export type LoadedWsrtConfig = {
    root: string;
    configFile?: string;
    config: WsrtConfig;
    sources: ConfigSource[];
    diagnostics: WsrtDiagnostic[];
};
export type WorkspacePackage = {
    name: string;
    root: string;
    packageJson: string;
    sourceEntry?: string;
    version?: string;
    private?: boolean;
    dependencies: string[];
    exports: Record<string, string>;
    resolvedExports: Record<string, string>;
    metadata: Record<string, unknown>;
};
export type WorkspaceGraph = {
    nodes: Array<{
        id: string;
        root: string;
        kind?: string;
        metadata?: Record<string, unknown>;
    }>;
    edges: Array<{
        from: string;
        to: string;
        type: 'workspace' | 'external' | (string & {});
        metadata?: Record<string, unknown>;
    }>;
};
export type RuntimeGraphNode = {
    id: string;
    root: string;
    kind: 'package' | 'project' | (string & {});
    metadata?: Record<string, unknown>;
};
export type RuntimeGraphEdge = {
    from: string;
    to: string;
    type: 'workspace' | 'external' | 'project' | (string & {});
    metadata?: Record<string, unknown>;
};
export type RuntimeGraphQuery = {
    node?: string;
    kind?: 'package' | 'project' | 'all' | (string & {});
    direction?: 'dependencies' | 'dependents' | 'both';
};
export type RuntimeGraphProjectView = {
    project: RuntimeProject;
    packages: WorkspacePackage[];
    edges: RuntimeGraphEdge[];
};
export type RuntimeGraphPackageView = {
    package: WorkspacePackage;
    dependencies: WorkspacePackage[];
    dependents: WorkspacePackage[];
    edges: RuntimeGraphEdge[];
};
export type RuntimeGraphModel = WorkspaceGraph & {
    node: (id: string) => RuntimeGraphNode | undefined;
    query: (query?: RuntimeGraphQuery) => {
        nodes: RuntimeGraphNode[];
        edges: RuntimeGraphEdge[];
    };
    dependencies: (name: string) => WorkspacePackage[];
    dependents: (name: string) => WorkspacePackage[];
    forProject: (name: string) => RuntimeGraphProjectView | undefined;
    forPackage: (name: string) => RuntimeGraphPackageView | undefined;
};
export type ResolutionResult = {
    specifier: string;
    resolved?: string;
    source: 'alias' | 'package' | 'export' | 'unresolved';
    packageName?: string;
};
export type RuntimeProject = {
    name: string;
    root: string;
    adapter: AdapterName;
    config: ProjectConfig;
    environment: RuntimeResolvedEnvironment;
    processes: RuntimeProject[];
};
export type WorkspaceRuntimeState = {
    root: string;
    profile: RuntimeProfile;
    configFile?: string;
    configSources: ConfigSource[];
    projects: RuntimeProject[];
    packages: WorkspacePackage[];
    aliases: Record<string, string>;
    graph: WorkspaceGraph;
    diagnostics: WsrtDiagnostic[];
    reports: Record<string, unknown>;
    services: RuntimeService[];
    tsconfig: {
        enabled: boolean;
        mode: SyncMode;
        files: SyncFileStatus[];
    };
    manifests: {
        enabled: boolean;
        mode: SyncMode;
        files: SyncFileStatus[];
    };
    virtualImports: VirtualImportState;
    artifacts: RuntimeArtifact[];
    timeline: RuntimeTimelineEntry[];
    plugins: {
        names: string[];
        hooks: Record<string, string[]>;
        metadata: WsrtPluginMetadata[];
        list: () => WsrtPluginMetadata[];
    };
    pluginData: Record<string, unknown>;
    dashboard: {
        routes: DashboardRoute[];
        pages: DashboardPluginPage[];
    };
    mcp: McpRuntimeState;
};
export type RuntimeDiagnostics = {
    add: (diagnostic: WsrtDiagnostic) => WsrtDiagnostic;
    list: () => WsrtDiagnostic[];
    byProject: (project: string | RuntimeProject) => WsrtDiagnostic[];
    byPackage: (pkg: string | WorkspacePackage) => WsrtDiagnostic[];
};
export type RuntimeConfigAccess = WsrtConfig & {
    raw: WsrtConfig;
    get: {
        (): WsrtConfig;
        <Key extends keyof WsrtConfig>(key: Key): WsrtConfig[Key];
    };
};
export type WorkspaceRuntime = {
    state: WorkspaceRuntimeState;
    root: string;
    profile: RuntimeProfile;
    projects: RuntimeProject[];
    packages: WorkspacePackage[];
    graph: RuntimeGraphModel;
    services: RuntimeServiceRegistry;
    plugins: WorkspaceRuntimeState['plugins'];
    diagnostics: RuntimeDiagnostics;
    artifacts: RuntimeArtifact[];
    events: RuntimeEventBus;
    timeline: RuntimeTimeline;
    query: RuntimeQuery;
    cli: RuntimeCliRegistry;
    tasks: RuntimeTaskRegistry;
    commands: RuntimeCommandRegistry;
    setPluginData: (plugin: string, key: string, data: unknown) => void;
    config: RuntimeConfigAccess;
    inspect: () => WorkspaceRuntimeState;
    start: () => Promise<ProjectHandle[]>;
    stop: () => Promise<void>;
    resolve: (specifier: string) => ResolutionResult;
    runProject: (name: string) => Promise<ProjectHandle>;
    syncTsconfig: (mode?: SyncMode) => Promise<SyncFileStatus[]>;
    syncManifests: (mode?: SyncMode) => Promise<SyncFileStatus[]>;
    generateArtifacts: () => Promise<RuntimeArtifact[]>;
    getVirtualModule: (id: string) => VirtualImport | undefined;
};
export type ProjectHandle = {
    name: string;
    adapter: AdapterName;
    url?: string;
    status: 'running' | 'exited';
    metadata: Record<string, unknown>;
    close: () => Promise<void>;
};
export type AdapterContext = {
    runtime: WorkspaceRuntime;
    project: RuntimeProject;
};
export type ProjectAdapter = {
    name: AdapterName;
    start: (context: AdapterContext) => Promise<ProjectHandle>;
};
export type CommandHandle = ProjectHandle & {
    process?: ChildProcess;
};
export type WsrtVitePluginOptions = {
    runtime?: WorkspaceRuntime;
    diagnostics?: WsrtDiagnostic[];
};
export type OrchestratedViteConfigOptions = {
    runtime: WorkspaceRuntime;
    project: RuntimeProject;
};
export type ViteIntegrationStatus = {
    configFile?: string;
    autoInjected: boolean;
    manualPluginDetected: boolean;
    duplicateInjectionAvoided: boolean;
    userPluginCount: number;
};
export type OrchestratedViteConfig = {
    config: InlineConfig;
    userConfig: UserConfig;
    status: ViteIntegrationStatus;
};
export type WsrtVitePlugin = Plugin & {
    name: 'wsrt';
};
//# sourceMappingURL=index.d.ts.map