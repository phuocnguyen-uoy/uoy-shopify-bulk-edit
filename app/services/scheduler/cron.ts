import { CronExpressionParser } from "cron-parser";

export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: Date,
): Date {
  if (!expression.trim()) throw new Error("Cron expression is required");
  const interval = CronExpressionParser.parse(expression, {
    currentDate: after,
    tz: timezone,
  });
  return interval.next().toDate();
}

export function occurrenceKey(taskId: string, scheduledFor: Date) {
  return `apply:${taskId}:${scheduledFor.toISOString()}`;
}
