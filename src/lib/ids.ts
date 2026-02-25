let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${counter.toString(36)}`;
}
