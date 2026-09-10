import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export function normalizeShopDomain(shop: string): string {
  const normalized = shop.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new Response("Invalid shop domain", { status: 400 });
  }
  return normalized;
}

export function tenantDb(db: DbClient, rawShopDomain: string) {
  const shopDomain = normalizeShopDomain(rawShopDomain);

  return {
    shopDomain,
    task: {
      findMany: (args: Omit<Prisma.TaskFindManyArgs, "where"> = {}) =>
        db.task.findMany({ ...args, where: { shopDomain } }),
      findDetail: (id: string) =>
        db.task.findFirst({
          where: { id, shopDomain },
          include: {
            runs: {
              orderBy: { createdAt: "desc" },
              take: 100,
              include: { _count: { select: { changes: true } } },
            },
          },
        }),
      listDashboard: () =>
        db.task.findMany({
          where: { shopDomain },
          orderBy: { updatedAt: "desc" },
          take: 50,
          include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
        }),
      findUnique: (id: string) =>
        db.task.findFirst({ where: { id, shopDomain } }),
      create: (data: Omit<Prisma.TaskUncheckedCreateInput, "shopDomain">) =>
        db.task.create({ data: { ...data, shopDomain } }),
      delete: (id: string) => db.task.deleteMany({ where: { id, shopDomain } }),
      schedule: (
        id: string,
        data: Pick<
          Prisma.TaskUncheckedUpdateInput,
          | "status"
          | "selectionMode"
          | "scheduledAt"
          | "recurringCron"
          | "timezone"
          | "nextRunAt"
        >,
      ) =>
        db.task.updateMany({
          where: { id, shopDomain, status: { not: "ARCHIVED" } },
          data,
        }),
    },
    taskRun: {
      listHistory: () =>
        db.taskRun.findMany({
          where: { shopDomain },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            task: {
              select: {
                id: true,
                name: true,
                resourceType: true,
                frozenResourceIds: true,
              },
            },
            _count: { select: { changes: true } },
          },
        }),
      findRunDetail: (runId: string) =>
        db.taskRun.findFirst({
          where: { id: runId, shopDomain },
          include: {
            task: {
              select: {
                id: true,
                name: true,
                resourceType: true,
                frozenResourceIds: true,
              },
            },
            changes: { orderBy: { createdAt: "asc" } },
          },
        }),
      findMany: (args: Omit<Prisma.TaskRunFindManyArgs, "where"> = {}) =>
        db.taskRun.findMany({ ...args, where: { shopDomain } }),
      findUnique: (id: string) =>
        db.taskRun.findFirst({ where: { id, shopDomain } }),
      findForExecution: (id: string) =>
        db.taskRun.findFirst({
          where: { id, shopDomain, status: "PREPARING" },
          include: { task: true },
        }),
      create: (data: Omit<Prisma.TaskRunUncheckedCreateInput, "shopDomain">) =>
        db.taskRun.create({ data: { ...data, shopDomain } }),
      claimForExecution: (id: string) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, status: "QUEUED" },
          data: { status: "PREPARING", startedAt: new Date() },
        }),
      failPreparation: (id: string, error: Prisma.InputJsonValue) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, status: "PREPARING" },
          data: { status: "FAILED", error, completedAt: new Date() },
        }),
      recordRollbackConflicts: (id: string, resourceGids: string[]) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, kind: "REVERT", status: "PREPARING" },
          data: {
            error: {
              code: "ROLLBACK_CONFLICTS",
              skipped: resourceGids.length,
              resourceGids,
              message: `Skipped ${resourceGids.length} resource(s) because their current values differ from the bulk edit. These resources were not reverted.`,
            },
          },
        }),
      completeWithoutOperation: (id: string, skipped = 0) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, status: "PREPARING" },
          data: {
            status: skipped > 0 ? "PARTIALLY_FAILED" : "COMPLETED",
            stats: { rows: 0, succeeded: 0, failed: 0, skipped, errors: [] },
            completedAt: new Date(),
          },
        }),
      attachShopifyOperation: (
        id: string,
        shopifyOperationId: string,
        totalCount: number,
      ) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, status: "PREPARING" },
          data: {
            shopifyOperationId,
            status: "RUNNING",
            stats: { totalCount, processedCount: 0 },
          },
        }),
      updateRunProgress: (
        id: string,
        shopifyOperationId: string,
        processedCount: number,
        totalCount: number,
      ) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, shopifyOperationId, status: "RUNNING" },
          data: { stats: { totalCount, processedCount } },
        }),
      reconcileOperation: (
        id: string,
        shopifyOperationId: string,
        data: Pick<
          Prisma.TaskRunUncheckedUpdateInput,
          "status" | "stats" | "error" | "completedAt"
        >,
      ) =>
        db.taskRun.updateMany({
          where: { id, shopDomain, shopifyOperationId, status: "RUNNING" },
          data,
        }),
    },
    taskChange: {
      findMany: (args: Omit<Prisma.TaskChangeFindManyArgs, "where"> = {}) =>
        db.taskChange.findMany({ ...args, where: { shopDomain } }),
      findUnique: (id: string) =>
        db.taskChange.findFirst({ where: { id, shopDomain } }),
      create: (
        data: Omit<Prisma.TaskChangeUncheckedCreateInput, "shopDomain">,
      ) => db.taskChange.create({ data: { ...data, shopDomain } }),
      findForRun: (runId: string) =>
        db.taskChange.findMany({ where: { shopDomain, runId } }),
      createMany: (
        data: Array<Omit<Prisma.TaskChangeCreateManyInput, "shopDomain">>,
      ) =>
        db.taskChange.createMany({
          data: data.map((item) => ({ ...item, shopDomain })),
        }),
    },
    savedTask: {
      findMany: (args: Omit<Prisma.SavedTaskFindManyArgs, "where"> = {}) =>
        db.savedTask.findMany({ ...args, where: { shopDomain } }),
      findUnique: (id: string) =>
        db.savedTask.findFirst({ where: { id, shopDomain } }),
      create: (
        data: Omit<Prisma.SavedTaskUncheckedCreateInput, "shopDomain">,
      ) => db.savedTask.create({ data: { ...data, shopDomain } }),
    },
    webhookReceipt: {
      findUnique: (webhookId: string) =>
        db.webhookReceipt.findUnique({
          where: { shopDomain_webhookId: { shopDomain, webhookId } },
        }),
      create: (
        data: Omit<Prisma.WebhookReceiptUncheckedCreateInput, "shopDomain">,
      ) => db.webhookReceipt.create({ data: { ...data, shopDomain } }),
    },
  };
}
