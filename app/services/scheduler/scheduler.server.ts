import { Prisma, type Task } from "@prisma/client";
import db from "../../db.server";
import { tenantDb } from "../tenant.server";
import { nextCronOccurrence, occurrenceKey } from "./cron";

type ScheduleInput = {
  runAt: Date;
  timezone: string;
  recurringCron?: string;
};

export async function scheduleTask(
  shopDomain: string,
  taskId: string,
  input: ScheduleInput,
) {
  if (input.runAt <= new Date()) {
    throw new Response("Scheduled time must be in the future", { status: 422 });
  }

  if (input.recurringCron) {
    nextCronOccurrence(input.recurringCron, input.timezone, input.runAt);
  }

  const updated = await tenantDb(db, shopDomain).task.schedule(taskId, {
    status: "SCHEDULED",
    scheduledAt: input.runAt,
    recurringCron: input.recurringCron ?? null,
    timezone: input.timezone,
    nextRunAt: input.runAt,
  });
  if (updated.count !== 1) throw new Response("Task not found", { status: 404 });
}

type DueTask = Pick<
  Task,
  "id" | "shopDomain" | "nextRunAt" | "recurringCron" | "timezone"
>;

async function claimOccurrence(task: DueTask) {
  if (!task.nextRunAt) return null;
  const scheduledFor = task.nextRunAt;
  const nextRunAt = task.recurringCron
    ? nextCronOccurrence(task.recurringCron, task.timezone, scheduledFor)
    : null;

  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.task.findFirst({
        where: {
          id: task.id,
          shopDomain: task.shopDomain,
          nextRunAt: scheduledFor,
          status: "SCHEDULED",
        },
        select: { id: true },
      });
      if (!current) return null;

      const run = await tx.taskRun.create({
        data: {
          shopDomain: task.shopDomain,
          taskId: task.id,
          idempotencyKey: occurrenceKey(task.id, scheduledFor),
          scheduledFor,
        },
      });
      const advanced = await tx.task.updateMany({
        where: {
          id: task.id,
          shopDomain: task.shopDomain,
          nextRunAt: scheduledFor,
          status: "SCHEDULED",
        },
        data: {
          nextRunAt,
          status: nextRunAt ? "SCHEDULED" : "ACTIVE",
        },
      });
      if (advanced.count !== 1) throw new Error("Schedule claim lost");
      return run;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null;
    }
    throw error;
  }
}

// Privileged system scan: it selects scheduling metadata only. Every claim and
// write is subsequently constrained by both shopDomain and task id.
export async function claimDueTasks(now = new Date(), limit = 25) {
  const due = await db.task.findMany({
    where: { status: "SCHEDULED", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      shopDomain: true,
      nextRunAt: true,
      recurringCron: true,
      timezone: true,
    },
  });

  const claimed = [];
  for (const task of due) {
    const run = await claimOccurrence(task);
    if (run) claimed.push(run);
  }
  return claimed;
}
