export const validTaskKey = (value: string): boolean =>
  /^0x[0-9a-f]{40}:[a-z0-9][a-z0-9_-]{2,63}$/i.test(value.trim());

export function rememberedTaskKey(search: string, saved: string | null): string {
  const linked = new URLSearchParams(search).get("task") || "";
  if (validTaskKey(linked)) return linked.trim().toLowerCase();
  return saved && validTaskKey(saved) ? saved.trim().toLowerCase() : "";
}

export function taskStorageKey(contract: string): string {
  return `taskroute:last-task:${contract.toLowerCase()}`;
}
