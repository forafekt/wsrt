// deno-lint-ignore-file no-explicit-any
export function fromDefaults(
  defaults: Record<string, any>,
) {
  return () => defaults;
}
