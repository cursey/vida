export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function makePageKey(index: number, pageSize: number): number {
  return Math.floor(index / pageSize);
}

export function parseHexRva(value: string): number | null {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}
