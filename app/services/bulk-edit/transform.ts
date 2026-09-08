import type { ResourceType } from "@prisma/client";
import type { EditAction } from "../tasks/types";
import { requireField } from "./field-registry";

type Snapshot = Record<string, unknown>;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\\x24&");
}

function transformValue(current: unknown, action: EditAction) {
  switch (action.operation) {
    case "set": return action.value;
    case "clear": return null;
    case "find_replace": {
      if (typeof current !== "string" || action.find === undefined) {
        throw new Error("find_replace requires a string field and find value");
      }
      if (action.find.length === 0) throw new Error("find_replace requires a non-empty find value");
      return current.replace(new RegExp(escapeRegExp(action.find), "gi"), action.replace ?? "");
    }
    case "add": {
      if (Array.isArray(current)) return [...new Set([...current, action.value])];
      if (typeof current === "string") return current + String(action.value ?? "");
      throw new Error("add requires a string or list field");
    }
    case "remove": {
      if (Array.isArray(current)) return current.filter((item) => item !== action.value);
      if (typeof current === "string") return current.split(String(action.value ?? "")).join("");
      throw new Error("remove requires a string or list field");
    }
    case "increase_fixed":
    case "decrease_fixed":
    case "increase_percent":
    case "decrease_percent": {
      const currentNumber = Number(current);
      const operand = Number(action.value);
      if (!Number.isFinite(currentNumber) || !Number.isFinite(operand) || operand < 0) {
        throw new Error("Numeric adjustment requires finite non-negative numbers");
      }
      const direction = action.operation.startsWith("increase") ? 1 : -1;
      const delta = action.operation.endsWith("percent")
        ? currentNumber * operand / 100
        : operand;
      const adjusted = money(currentNumber + direction * delta);
      const result = action.field === "price" || action.field === "compareAtPrice" || action.field === "variantPrice" || action.field === "variantCompareAtPrice"
        ? Math.max(0, adjusted)
        : adjusted;
      return typeof current === "string" ? result.toFixed(2) : result;
    }
  }
}

export function applyActions(
  resource: ResourceType,
  snapshot: Snapshot,
  actions: EditAction[],
): Snapshot {
  const result = structuredClone(snapshot);
  for (const action of actions) {
    const field = requireField(resource, action.field);
    if (!field.editable) throw new Error(`Field is read-only: ${action.field}`);
    result[action.field] = transformValue(result[action.field], action);
  }
  return result;
}
