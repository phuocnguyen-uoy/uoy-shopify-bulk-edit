import type { ResourceType } from "@prisma/client";
import { RE2JS } from "re2js";
import type { EditAction } from "../tasks/types";
import { requireField } from "./field-registry";

type Snapshot = Record<string, unknown>;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\\x24&");
}

const MAX_REGEX_PATTERN_LENGTH = 256;
const MAX_REGEX_INPUT_LENGTH = 100_000;

function compileRegex(pattern: string, rawFlags = "g") {
  if (pattern.length === 0 || pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(
      `Regex pattern must contain 1-${MAX_REGEX_PATTERN_LENGTH} characters`,
    );
  }
  if (
    !/^[gims]*$/.test(rawFlags) ||
    new Set(rawFlags).size !== rawFlags.length
  ) {
    throw new Error("Regex flags may only contain g, i, m, and s once each");
  }
  let flags = 0;
  if (rawFlags.includes("i")) flags |= RE2JS.CASE_INSENSITIVE;
  if (rawFlags.includes("m")) flags |= RE2JS.MULTILINE;
  if (rawFlags.includes("s")) flags |= RE2JS.DOTALL;
  try {
    return {
      pattern: RE2JS.compile(pattern, flags),
      global: rawFlags.includes("g"),
    };
  } catch (error) {
    throw new Error(
      `Invalid RE2 regex: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function transformValue(
  current: unknown,
  action: EditAction,
  snapshot: Snapshot,
) {
  switch (action.operation) {
    case "set":
      return action.value;
    case "clear":
      return null;
    case "find_replace": {
      if (typeof current !== "string" || action.find === undefined) {
        throw new Error("find_replace requires a string field and find value");
      }
      if (action.find.length === 0)
        throw new Error("find_replace requires a non-empty find value");
      return current.replace(
        new RegExp(escapeRegExp(action.find), "gi"),
        action.replace ?? "",
      );
    }
    case "regex_replace": {
      if (typeof current !== "string" || !action.find) {
        throw new Error(
          "regex_replace requires a string field and non-empty pattern",
        );
      }
      if (current.length > MAX_REGEX_INPUT_LENGTH) {
        throw new Error(
          `Regex input cannot exceed ${MAX_REGEX_INPUT_LENGTH} characters`,
        );
      }
      const regex = compileRegex(action.find, action.regexFlags);
      const matcher = regex.pattern.matcher(current);
      return regex.global
        ? matcher.replaceAll(action.replace ?? "")
        : matcher.replaceFirst(action.replace ?? "");
    }
    case "text_transform": {
      if (typeof current !== "string" || !action.textTransform) {
        throw new Error("text_transform requires a string field and transform");
      }
      switch (action.textTransform) {
        case "uppercase":
          return current.toUpperCase();
        case "lowercase":
          return current.toLowerCase();
        case "title_case":
          return current
            .toLowerCase()
            .replace(
              /(^|[\s_-])([\p{L}\p{N}])/gu,
              (_m, gap, char) => gap + char.toUpperCase(),
            );
        case "sentence_case":
          return current.length
            ? current[0].toUpperCase() + current.slice(1).toLowerCase()
            : current;
        case "trim":
          return current.trim();
        case "normalize_whitespace":
          return current.trim().replace(/\s+/g, " ");
        case "remove_html":
          return current.replace(/<[^>]*>/g, "");
        case "remove_emoji":
          return current.replace(/\p{Extended_Pictographic}/gu, "");
        case "prefix":
          return String(action.value ?? "") + current;
        case "suffix":
          return current + String(action.value ?? "");
        case "template":
          return String(action.value ?? "").replace(
            /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g,
            (_match, key: string) => String(snapshot[key] ?? ""),
          );
      }
      throw new Error("Unsupported text transform");
    }
    case "add": {
      if (Array.isArray(current))
        return [...new Set([...current, action.value])];
      if (typeof current === "string")
        return current + String(action.value ?? "");
      throw new Error("add requires a string or list field");
    }
    case "remove": {
      if (Array.isArray(current))
        return current.filter((item) => item !== action.value);
      if (typeof current === "string")
        return current.split(String(action.value ?? "")).join("");
      throw new Error("remove requires a string or list field");
    }
    case "increase_fixed":
    case "decrease_fixed":
    case "increase_percent":
    case "decrease_percent": {
      const currentNumber = Number(current);
      const operand = Number(action.value);
      if (
        !Number.isFinite(currentNumber) ||
        !Number.isFinite(operand) ||
        operand < 0
      ) {
        throw new Error(
          "Numeric adjustment requires finite non-negative numbers",
        );
      }
      const direction = action.operation.startsWith("increase") ? 1 : -1;
      const delta = action.operation.endsWith("percent")
        ? (currentNumber * operand) / 100
        : operand;
      const adjusted = money(currentNumber + direction * delta);
      const result =
        action.field === "price" ||
        action.field === "compareAtPrice" ||
        action.field === "variantPrice" ||
        action.field === "variantCompareAtPrice"
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
    result[action.field] = transformValue(result[action.field], action, result);
  }
  return result;
}
