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
  if (
    condition.operator === "in_list" ||
    condition.operator === "not_in_list"
  ) {
    const values =
      condition.values ??
      (typeof condition.value === "string"
        ? condition.value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : []);
    if (values.length === 0)
      throw new Error(`${condition.operator} requires at least one value`);
    const connective = condition.operator === "in_list" ? " OR " : " AND ";
    const prefix = condition.operator === "in_list" ? "" : "-";
    return values
      .map((item) => `${prefix}${key}:${quote(item)}`)
      .join(connective);
  }
  if (condition.operator === "between") {
    const bounds =
      condition.valueTo === undefined && typeof condition.value === "string"
        ? condition.value.split(",").map((item) => item.trim())
        : [condition.value, condition.valueTo];
    if (
      bounds.length !== 2 ||
      bounds.some((item) => item === undefined || item === "")
    ) {
      throw new Error("between requires lower and upper bounds");
    }
    return `${key}:>=${quote(bounds[0] as string | number)} AND ${key}:<=${quote(bounds[1] as string | number)}`;
  }
  if (condition.value === undefined)
    throw new Error(`Filter value is required for ${condition.field}`);

  if (
    (resource === "PRODUCT" && condition.field === "collectionId") ||
    (resource === "VARIANT" && condition.field === "productCollectionId")
  ) {
    const ids = String(condition.value)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
      throw new Error("Collection filter requires numeric collection IDs");
    }
    const clauses = ids.map((id) => `${key}:${quote(id)}`);
    if (condition.operator === "equals") return `(${clauses.join(" OR ")})`;
    if (condition.operator === "not_equals") {
      return `(${clauses.map((clause) => `-${clause}`).join(" AND ")})`;
    }
  }

  const value = quote(condition.value);
  switch (condition.operator) {
    case "equals":
      return `${key}:${value}`;
    case "contains":
      // Shopify only supports suffix wildcards for prefix queries. Use a
      // broad candidate query; preview applies the exact substring predicate.
      return `${key}:*`;
    case "starts_with":
      return `${key}:${quote(String(condition.value) + "*")}`;
    case "ends_with":
      return `${key}:*`;
    case "before":
    case "after":
      return `${key}:${condition.operator === "before" ? "<" : ">"}${value}`;
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
