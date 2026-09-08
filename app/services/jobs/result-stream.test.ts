import { describe, expect, it } from "vitest";
import { summarizeJsonl } from "./result-stream";

function stream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("summarizeJsonl", () => {
  it("handles rows split across chunks and captures Shopify user errors", async () => {
    const summary = await summarizeJsonl(stream([
      '{"data":{"productUpdate":{"userErrors":[]}}}\n{"data":{"product',
      'Update":{"userErrors":[{"message":"Bad title"}]}}}\n',
    ]));
    expect(summary).toEqual({
      rows: 2,
      succeeded: 1,
      failed: 1,
      errors: [{ line: 2, message: "Bad title" }],
    });
  });

  it("counts malformed rows without aborting the stream", async () => {
    const summary = await summarizeJsonl(stream(['not-json\n{"data":{}}']));
    expect(summary.rows).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(1);
  });

  it("caps stored error details while preserving counts", async () => {
    const summary = await summarizeJsonl(stream([
      '{"userErrors":[{"message":"one"}]}\n{"userErrors":[{"message":"two"}]}',
    ]), 1);
    expect(summary.failed).toBe(2);
    expect(summary.errors).toHaveLength(1);
  });
});
