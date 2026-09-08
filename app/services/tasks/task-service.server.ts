import { Prisma, type ResourceType, type SelectionMode } from "@prisma/client";
import db from "../../db.server";
import { tenantDb } from "../tenant.server";
import type { ActionDefinition, FilterDefinition } from "./types";

type CreateTaskInput = {
  name: string;
  resourceType: ResourceType;
  filters: FilterDefinition;
  actions: ActionDefinition;
  selectionMode?: SelectionMode;
  frozenResourceIds?: string[];
};

export async function createDraftTask(shop: string, input: CreateTaskInput) {
  if (!input.name.trim()) throw new Response("Task name is required", { status: 422 });
  if (input.actions.actions.length === 0) {
    throw new Response("At least one edit action is required", { status: 422 });
  }
  return tenantDb(db, shop).task.create({
    name: input.name.trim(),
    resourceType: input.resourceType,
    filterDefinition: input.filters,
    actionDefinition: input.actions,
    selectionMode: input.selectionMode ?? "FROZEN",
    frozenResourceIds: input.frozenResourceIds ?? undefined,
  });
}

export async function getTask(shop: string, taskId: string) {
  const task = await tenantDb(db, shop).task.findUnique(taskId);
  if (!task) throw new Response("Task not found", { status: 404 });
  return task;
}

export async function enqueueTaskNow(shop: string, taskId: string) {
  const scoped = tenantDb(db, shop);
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, shopDomain: scoped.shopDomain, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (!task) throw new Response("Task not found", { status: 404 });
    const active = await tx.taskRun.findFirst({
      where: {
        taskId,
        shopDomain: scoped.shopDomain,
        status: { in: ["QUEUED", "PREPARING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (active) throw new Response("Task already has an active run", { status: 409 });
    const now = new Date();
    const run = await tx.taskRun.create({
      data: {
        shopDomain: scoped.shopDomain,
        taskId,
        idempotencyKey: `manual:${taskId}:${crypto.randomUUID()}`,
        scheduledFor: now,
      },
    });
    await tx.task.updateMany({
      where: { id: taskId, shopDomain: scoped.shopDomain, status: { in: ["DRAFT", "PREVIEWED"] } },
      data: { status: "ACTIVE" },
    });
    return run;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Response("Task already has an active run", { status: 409 });
    }
    throw error;
  });
}

export async function enqueueRollback(shop: string, taskId: string, sourceRunId: string) {
  const scoped = tenantDb(db, shop);
  return db.$transaction(async (tx) => {
    const source = await tx.taskRun.findFirst({
      where: {
        id: sourceRunId,
        taskId,
        shopDomain: scoped.shopDomain,
        kind: "APPLY",
        status: "COMPLETED",
      },
      select: { id: true },
    });
    if (!source) throw new Response("Only completed apply runs can be rolled back", { status: 422 });
    const active = await tx.taskRun.findFirst({
      where: {
        taskId,
        shopDomain: scoped.shopDomain,
        status: { in: ["QUEUED", "PREPARING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (active) throw new Response("Task already has an active run", { status: 409 });
    return tx.taskRun.create({
      data: {
        shopDomain: scoped.shopDomain,
        taskId,
        kind: "REVERT",
        sourceRunId,
        idempotencyKey: `revert:${sourceRunId}:${crypto.randomUUID()}`,
        scheduledFor: new Date(),
      },
    });
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Response("This run already has a rollback", { status: 409 });
    }
    throw error;
  });
}
