function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).sort().join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function rollbackValuesMatch(actual: unknown, expected: unknown) {
  return canonicalJson(actual) === canonicalJson(expected);
}

export function rollbackSkippedCount(error: unknown, stats?: unknown): number {
  if (stats && typeof stats === "object" && "skipped" in stats &&
      typeof stats.skipped === "number" && Number.isSafeInteger(stats.skipped) && stats.skipped >= 0) {
    return stats.skipped;
  }
  if (!error || typeof error !== "object" || !("code" in error) ||
      error.code !== "ROLLBACK_CONFLICTS" || !("skipped" in error)) return 0;
  return typeof error.skipped === "number" && Number.isSafeInteger(error.skipped) && error.skipped > 0
    ? error.skipped : 0;
}
