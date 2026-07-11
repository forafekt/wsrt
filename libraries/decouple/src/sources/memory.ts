export function fromObject(
  obj: Record<string, string | undefined>,
) {
  return () => obj;
}
