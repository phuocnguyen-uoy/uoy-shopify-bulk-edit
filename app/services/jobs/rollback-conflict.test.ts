import { describe, expect, it } from "vitest";
import { rollbackSkippedCount, rollbackValuesMatch } from "./rollback-conflict";

describe("rollbackValuesMatch", () => {
  it("accepts equivalent snapshots regardless of object or tag order", () => {
    expect(rollbackValuesMatch(
      { title: "Updated", tags: ["featured", "sale"] },
      { tags: ["sale", "featured"], title: "Updated" },
    )).toBe(true);
  });

  it("detects a field changed after the bulk edit", () => {
    expect(rollbackValuesMatch(
      { title: "Changed manually" },
      { title: "Updated by bulk edit" },
    )).toBe(false);
  });
});

describe("rollbackSkippedCount", () => {
  const error = { code: "ROLLBACK_CONFLICTS", skipped: 3 };

  it("uses persisted summary count, including zero", () => {
    expect(rollbackSkippedCount(error, { skipped: 2 })).toBe(2);
    expect(rollbackSkippedCount(error, { skipped: 0 })).toBe(0);
  });

  it("falls back to the conflict payload before a summary exists", () => {
    expect(rollbackSkippedCount(error, { processedCount: 1 })).toBe(3);
    expect(rollbackSkippedCount(error, { skipped: -1 })).toBe(3);
    expect(rollbackSkippedCount(null, { skipped: "2" })).toBe(0);
  });
});
