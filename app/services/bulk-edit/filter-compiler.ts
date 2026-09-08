import type { ResourceType } from "@prisma/client";
import type { FilterCondition, FilterDefinition } from "../tasks/types";
import { requireField } from "./field-registry";

function quote(value: string | number | boolean) {
  if (typeof value !== "string") return String(value);
  // Quoting prevents boolean operators from becoming syntax. Strip structural
  // delimiters as defense-in-depth, then escape slash and quote characters.
  const safe = value.replace(/[():]/g, " ").replace(/\s+/g, " ").trim();
  return `"${safe.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function compileCondition(resource: ResourceType, condition: FilterCondition) {
  const field = requireField(resource, condition.field);
  if (!field.searchKey)
    throw new Error(
      `Field cannot be filtered through Shopify search: ${condition.field}`,
    );
  if (!field.filterOperators.includes(condition.operator)) {
    throw new Error(
      `Operator ${condition.operator} is invalid for ${condition.field}`,
    );
  }

  const key = field.searchKey;
  if (condition.operator === "is_empty") return `-${key}:*`;
  if (condition.operator === "is_not_empty") return `${key}:*`;
  if (condition.value === undefined)
    throw new Error(`Filter value is required for ${condition.field}`);

  const value = quote(condition.value);
  switch (condition.operator) {
    case "equals":
      return `${key}:${value}`;
    case "contains":
      // Shopify only supports suffix wildcards for prefix queries. Use a
      // broad candidate query; preview applies the exact substring predicate.
      return `${key}:*`;
    case "not_equals":
      return `-${key}:${value}`;
    case "not_contains":
      return "";
    case "greater_than":
      return `${key}:>${value}`;
    case "less_than":
      return `${key}:<${value}`;
    default:
      throw new Error(`Unsupported filter operator: ${condition.operator}`);
  }
}

export function compileProductSearch(
  resource: ResourceType,
  filter: FilterDefinition,
) {
  if (filter.conditions.length === 0) return "";
  const connective = filter.combinator === "and" ? " AND " : " OR ";
  return filter.conditions
    .map((item) => compileCondition(resource, item))
    .filter(Boolean)
    .map((condition) => `(${condition})`)
    .join(connective);
}
