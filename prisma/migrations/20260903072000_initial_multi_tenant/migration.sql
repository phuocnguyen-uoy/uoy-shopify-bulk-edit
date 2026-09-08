-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('PRODUCT', 'VARIANT', 'COLLECTION');

-- CreateEnum
CREATE TYPE "SelectionMode" AS ENUM ('FROZEN', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('APPLY', 'REVERT');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'PREPARING', 'RUNNING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('NONE', 'DETECTED', 'SKIPPED', 'FORCE_APPLIED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "filterDefinition" JSONB NOT NULL,
    "actionDefinition" JSONB NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
    "selectionMode" "SelectionMode" NOT NULL DEFAULT 'FROZEN',
    "frozenResourceIds" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "recurringCron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "kind" "RunKind" NOT NULL DEFAULT 'APPLY',
    "sourceRunId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "shopifyOperationId" TEXT,
    "stats" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskChange" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "conflictStatus" "ConflictStatus" NOT NULL DEFAULT 'NONE',
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedTask" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "filterDefinition" JSONB NOT NULL,
    "actionDefinition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Task_shopDomain_status_idx" ON "Task"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "Task_shopDomain_nextRunAt_idx" ON "Task"("shopDomain", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_shopDomain_id_key" ON "Task"("shopDomain", "id");

-- CreateIndex
CREATE INDEX "TaskRun_shopDomain_status_idx" ON "TaskRun"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "TaskRun_shopDomain_taskId_idx" ON "TaskRun"("shopDomain", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRun_shopDomain_id_key" ON "TaskRun"("shopDomain", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRun_shopDomain_idempotencyKey_key" ON "TaskRun"("shopDomain", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TaskChange_shopDomain_resourceGid_idx" ON "TaskChange"("shopDomain", "resourceGid");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChange_runId_resourceGid_key" ON "TaskChange"("runId", "resourceGid");

-- CreateIndex
CREATE INDEX "SavedTask_shopDomain_name_idx" ON "SavedTask"("shopDomain", "name");

-- CreateIndex
CREATE INDEX "WebhookReceipt_shopDomain_processedAt_idx" ON "WebhookReceipt"("shopDomain", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_shopDomain_webhookId_key" ON "WebhookReceipt"("shopDomain", "webhookId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_shopDomain_taskId_fkey" FOREIGN KEY ("shopDomain", "taskId") REFERENCES "Task"("shopDomain", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChange" ADD CONSTRAINT "TaskChange_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChange" ADD CONSTRAINT "TaskChange_shopDomain_runId_fkey" FOREIGN KEY ("shopDomain", "runId") REFERENCES "TaskRun"("shopDomain", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedTask" ADD CONSTRAINT "SavedTask_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;


-- A task may have only one live execution. This closes the race between two
-- concurrent manual clicks or worker claims at the database boundary.
CREATE UNIQUE INDEX "TaskRun_one_active_per_task"
ON "TaskRun"("shopDomain", "taskId")
WHERE "status" IN ('QUEUED', 'PREPARING', 'RUNNING');

CREATE INDEX "TaskRun_shopDomain_sourceRunId_idx"
ON "TaskRun"("shopDomain", "sourceRunId");

-- Only one live or successful rollback may target an apply run.
CREATE UNIQUE INDEX "TaskRun_one_revert_per_source"
ON "TaskRun"("shopDomain", "sourceRunId")
WHERE "kind" = 'REVERT'
  AND "sourceRunId" IS NOT NULL
  AND "status" IN ('QUEUED', 'PREPARING', 'RUNNING', 'COMPLETED');
