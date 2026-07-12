export type SpawnRequest={command:string;args:readonly string[];cwd:string;environment:Readonly<Record<string,string>>;shell?:boolean;signal?:AbortSignal}
export type ProcessHandle={pid:number;running:boolean;exit:Promise<{code:number|null;signal:string|null}>;terminate(signal?:string):void}
export interface SpawnCapability{spawn(request:SpawnRequest):ProcessHandle}
export interface FileSystemCapability{readText(file:string):Promise<string>;writeText(file:string,contents:string):Promise<void>;exists(file:string):Promise<boolean>}
export interface EnvironmentCapability{all():Readonly<Record<string,string|undefined>>;get(name:string):string|undefined}
export interface ProcessInformationCapability{cwd():string;pid():number;platform():string}
export interface HttpCapability{fetch(input:string,init?:RequestInit):Promise<Response>}
export interface TimerCapability{delay(milliseconds:number,signal?:AbortSignal):Promise<void>}
export interface LoggerCapability{log(level:'debug'|'info'|'warning'|'error',message:string,attributes?:Readonly<Record<string,unknown>>):void}
export type CapabilityMap={spawn:SpawnCapability;filesystem:FileSystemCapability;environment:EnvironmentCapability;process:ProcessInformationCapability;http:HttpCapability;timers:TimerCapability;logger:LoggerCapability}
export class CapabilityRegistry{readonly #values=new Map<keyof CapabilityMap,unknown>();provide<K extends keyof CapabilityMap>(key:K,value:CapabilityMap[K]):this{this.#values.set(key,value);return this}require<K extends keyof CapabilityMap>(key:K):CapabilityMap[K]{const value=this.#values.get(key);if(!value)throw new Error(`Runtime capability not available: ${key}`);return value as CapabilityMap[K]}has(key:keyof CapabilityMap):boolean{return this.#values.has(key)}}
export interface RuntimeInstance{readonly provider:string;readonly capabilities:CapabilityRegistry;dispose():Promise<void>}
export interface RuntimeProvider{readonly id:string;detect():Promise<{available:boolean;version?:string}>;create():Promise<RuntimeInstance>}
