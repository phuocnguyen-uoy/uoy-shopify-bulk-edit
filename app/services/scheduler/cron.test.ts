import { describe, expect, it } from "vitest";
import { nextCronOccurrence, occurrenceKey } from "./cron";

describe("scheduler cron", () => {
  it("calculates timezone-aware recurring occurrences", () => {
    const next = nextCronOccurrence(
      "0 9 * * *",
      "Asia/Ho_Chi_Minh",
      new Date("2026-09-03T03:00:00.000Z"),
    );
    expect(next.toISOString()).toBe("2026-09-04T02:00:00.000Z");
  });

  it("creates stable idempotency keys", () => {
    expect(occurrenceKey("task_1", new Date("2026-09-03T02:00:00.000Z")))
      .toBe("apply:task_1:2026-09-03T02:00:00.000Z");
  });

  it("rejects invalid cron expressions", () => {
    expect(() => nextCronOccurrence("not cron", "UTC", new Date())).toThrow();
  });
});
