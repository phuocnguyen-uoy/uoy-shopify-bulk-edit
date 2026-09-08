export type BulkResultSummary = {
  rows: number;
  succeeded: number;
  failed: number;
  errors: Array<{ line: number; message: string }>;
};

function extractErrors(row: Record<string, unknown>) {
  const messages: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "userErrors" && Array.isArray(child)) {
        for (const error of child) {
          if (error && typeof error === "object" && "message" in error) {
            messages.push(String(error.message));
          }
        }
      } else {
        visit(child);
      }
    }
  };
  visit(row);
  return messages;
}

export async function summarizeJsonl(
  stream: ReadableStream<Uint8Array>,
  maxStoredErrors = 100,
): Promise<BulkResultSummary> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineNumber = 0;
  const summary: BulkResultSummary = { rows: 0, succeeded: 0, failed: 0, errors: [] };

  const consume = (line: string) => {
    if (!line.trim()) return;
    lineNumber += 1;
    summary.rows += 1;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const messages = extractErrors(row);
      if (messages.length) {
        summary.failed += 1;
        if (summary.errors.length < maxStoredErrors) {
          summary.errors.push({ line: lineNumber, message: messages.join("; ") });
        }
      } else {
        summary.succeeded += 1;
      }
    } catch {
      summary.failed += 1;
      if (summary.errors.length < maxStoredErrors) {
        summary.errors.push({ line: lineNumber, message: "Invalid JSONL result row" });
      }
    }
  };

  let streamDone = false;
  while (!streamDone) {
    const { value, done } = await reader.read();
    streamDone = done;
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  return summary;
}
