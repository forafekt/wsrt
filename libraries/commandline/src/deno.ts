// Ignore the TypeScript errors
// Since this file will only be used in Deno runtime

let Deno: any;
if (typeof (globalThis as any).Deno !== 'undefined') {
  Deno = (globalThis as any).Deno;
} else if (typeof window !== 'undefined' && typeof (window as any).Deno !== 'undefined') {
  Deno = (window as any).Deno;
} else if (typeof global !== 'undefined' && typeof (global as any).Deno !== 'undefined') {
  Deno = (global as any).Deno;
}

export const processArgs = ["deno", "cli"].concat(Deno.args);

export const platformInfo = `${Deno.build.os}-${Deno.build.arch} deno-${Deno.version.deno}`;

