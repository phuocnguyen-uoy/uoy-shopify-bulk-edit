import { useMemo, useState } from "react";
import styles from "./MultiRuleBuilder.module.css";
import { CollectionPicker } from "./CollectionPicker";
import type {
  EditAction,
  FilterCondition,
  FilterDefinition,
  FilterOperator,
  TextTransform,
} from "../services/tasks/types";

export type BuilderField = {
  value: string;
  label: string;
  kind: "string" | "string_list" | "number" | "date" | "status" | "boolean";
};

type Props = {
  filterFields: BuilderField[];
  actionFields: BuilderField[];
  initialFilters?: FilterDefinition | null;
  initialActions?: EditAction[] | null;
};

const COLLECTION_OPERATORS: Array<[FilterOperator, string]> = [
  ["equals", "Is in any of"],
  ["not_equals", "Is not in any of"],
];

const TEXT_OPERATORS: Array<[FilterOperator, string]> = [
  ["contains", "Contains"],
  ["not_contains", "Does not contain"],
  ["equals", "Equals"],
  ["not_equals", "Does not equal"],
  ["starts_with", "Starts with"],
  ["ends_with", "Ends with"],
  ["in_list", "Is in list"],
  ["not_in_list", "Is not in list"],
  ["is_empty", "Is empty"],
  ["is_not_empty", "Is not empty"],
];
const NUMBER_OPERATORS: Array<[FilterOperator, string]> = [
  ["greater_than", "Greater than"],
  ["less_than", "Less than"],
  ["equals", "Equals"],
  ["not_equals", "Does not equal"],
  ["between", "Between"],
  ["in_list", "Is in list"],
  ["is_empty", "Is empty"],
  ["is_not_empty", "Is not empty"],
];
const DATE_OPERATORS: Array<[FilterOperator, string]> = [
  ["after", "After"],
  ["before", "Before"],
  ["between", "Between"],
  ["is_empty", "Is empty"],
  ["is_not_empty", "Is not empty"],
];
const TEXT_TRANSFORMS: Array<[TextTransform, string]> = [
  ["trim", "Trim whitespace"],
  ["normalize_whitespace", "Normalize whitespace"],
  ["uppercase", "UPPERCASE"],
  ["lowercase", "lowercase"],
  ["title_case", "Title Case"],
  ["sentence_case", "Sentence case"],
  ["remove_html", "Remove HTML tags"],
  ["remove_emoji", "Remove emoji"],
  ["prefix", "Add prefix"],
  ["suffix", "Add suffix"],
  ["template", "Build from template"],
];

function defaultCondition(fields: BuilderField[]): FilterCondition {
  return {
    field: fields[0]?.value ?? "title",
    operator: "contains",
    value: "",
  };
}

function defaultAction(fields: BuilderField[]): EditAction {
  return { field: fields[0]?.value ?? "title", operation: "set", value: "" };
}

function operators(kind: BuilderField["kind"]) {
  if (kind === "number") return NUMBER_OPERATORS;
  if (kind === "date") return DATE_OPERATORS;
  if (kind === "boolean" || kind === "status") {
    return [
      ["equals", "Is"],
      ["not_equals", "Is not"],
    ] as Array<[FilterOperator, string]>;
  }
  return TEXT_OPERATORS;
}

function actionOperations(kind: BuilderField["kind"]) {
  if (kind === "number")
    return [
      ["set", "Set value"],
      ["clear", "Clear value"],
      ["increase_fixed", "Increase by amount"],
      ["decrease_fixed", "Decrease by amount"],
      ["increase_percent", "Increase by percent"],
      ["decrease_percent", "Decrease by percent"],
    ] as Array<[EditAction["operation"], string]>;
  if (kind === "boolean" || kind === "status")
    return [["set", "Set value"]] as Array<[EditAction["operation"], string]>;
  if (kind === "string_list")
    return [
      ["set", "Replace all"],
      ["clear", "Clear all"],
      ["add", "Add item"],
      ["remove", "Remove item"],
    ] as Array<[EditAction["operation"], string]>;
  return [
    ["set", "Set value"],
    ["clear", "Clear value"],
    ["find_replace", "Find and replace"],
    ["regex_replace", "Regex replace"],
    ["text_transform", "Text transform"],
    ["add", "Append text"],
    ["remove", "Remove text"],
  ] as Array<[EditAction["operation"], string]>;
}

export function MultiRuleBuilder({
  filterFields,
  actionFields,
  initialFilters,
  initialActions,
}: Props) {
  const [combinator, setCombinator] = useState<"and" | "or">(
    initialFilters?.combinator ?? "and",
  );
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initialFilters?.conditions.length
      ? initialFilters.conditions
      : [defaultCondition(filterFields)],
  );
  const [actions, setActions] = useState<EditAction[]>(
    initialActions?.length ? initialActions : [defaultAction(actionFields)],
  );

  const filtersJson = useMemo(
    () => JSON.stringify({ combinator, conditions }),
    [combinator, conditions],
  );
  const actionsJson = useMemo(() => JSON.stringify({ actions }), [actions]);

  const updateCondition = (index: number, patch: Partial<FilterCondition>) =>
    setConditions((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const updateAction = (index: number, patch: Partial<EditAction>) =>
    setActions((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const moveAction = (index: number, direction: -1 | 1) =>
    setActions((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <>
      <input type="hidden" name="filtersJson" value={filtersJson} />
      <input type="hidden" name="actionsJson" value={actionsJson} />

      <s-section heading="Filter resources">
        <div className={styles.ruleList}>
          <div className={styles.matchMode}>
            <span>Match resources when</span>
            <select
              value={combinator}
              onChange={(event) =>
                setCombinator(event.currentTarget.value as "and" | "or")
              }
            >
              <option value="and">all conditions match (AND)</option>
              <option value="or">any condition matches (OR)</option>
            </select>
          </div>

          {conditions.map((condition, index) => {
            const field =
              filterFields.find((item) => item.value === condition.field) ??
              filterFields[0];
            const available = condition.field === "collectionId"
              ? COLLECTION_OPERATORS
              : operators(field?.kind ?? "string");
            const noValue =
              condition.operator === "is_empty" ||
              condition.operator === "is_not_empty";
            const isList =
              condition.operator === "in_list" ||
              condition.operator === "not_in_list";
            const isBetween = condition.operator === "between";
            return (
              <div key={index} className={styles.ruleRow}>
                <span className={styles.ruleLabel}>Filter {index + 1}</span>

                <select
                  aria-label={`Filter ${index + 1} field`}
                  className={styles.select}
                  value={condition.field}
                  onChange={(event) => {
                    const selected =
                      filterFields.find(
                        (item) => item.value === event.currentTarget.value,
                      ) ?? filterFields[0];
                    const defaultOp = selected.value === "collectionId"
                      ? "equals"
                      : operators(selected.kind)[0][0];
                    updateCondition(index, {
                      field: selected.value,
                      operator: defaultOp,
                      value: "",
                      valueTo: undefined,
                      values: undefined,
                    });
                  }}
                >
                  {filterFields.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`Filter ${index + 1} operator`}
                  className={styles.select}
                  value={condition.operator}
                  onChange={(event) =>
                    updateCondition(index, {
                      operator: event.currentTarget.value as FilterOperator,
                      valueTo: undefined,
                      values: undefined,
                    })
                  }
                >
                  {available.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                {!noValue && condition.field === "collectionId" ? (
                  <div className={styles.collectionPickerWrapper}>
                    <CollectionPicker
                      name={`_collectionPicker_${index}`}
                      defaultValue={String(condition.value ?? "")}
                      onChange={(ids) => updateCondition(index, { value: ids })}
                    />
                  </div>
                ) : !noValue ? (
                  <input
                    aria-label={`Filter ${index + 1} value`}
                    className={styles.input}
                    type={
                      field?.kind === "date"
                        ? "date"
                        : field?.kind === "number" && !isList
                          ? "number"
                          : "text"
                    }
                    value={
                      isList
                        ? (condition.values ?? []).join(", ")
                        : String(condition.value ?? "")
                    }
                    placeholder={isList ? "value1, value2, value3" : "Value"}
                    onChange={(event) =>
                      isList
                        ? updateCondition(index, {
                            values: event.currentTarget.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                            value: undefined,
                          })
                        : updateCondition(index, {
                            value: event.currentTarget.value,
                          })
                    }
                  />
                ) : null}

                {isBetween && (
                  <input
                    aria-label={`Filter ${index + 1} upper bound`}
                    className={styles.input}
                    type={field?.kind === "date" ? "date" : "number"}
                    value={String(condition.valueTo ?? "")}
                    placeholder="Upper bound"
                    onChange={(event) =>
                      updateCondition(index, {
                        valueTo: event.currentTarget.value,
                      })
                    }
                  />
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={conditions.length === 1}
                    onClick={() =>
                      setConditions((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className={styles.addButton}
            onClick={() =>
              setConditions((items) => [
                ...items,
                defaultCondition(filterFields),
              ])
            }
          >
            + Add filter
          </button>
        </div>
      </s-section>

      <s-section heading="Define the edits">
        <div className={styles.ruleList}>
          <p className={styles.orderHint}>Actions run from top to bottom.</p>

          {actions.map((action, index) => {
            const field =
              actionFields.find((item) => item.value === action.field) ??
              actionFields[0];
            const available = actionOperations(field?.kind ?? "string");
            const isFindReplace =
              action.operation === "find_replace" ||
              action.operation === "regex_replace";
            const isTextTransform = action.operation === "text_transform";
            const isClear = action.operation === "clear";
            const needsTransformValue = ["prefix", "suffix", "template"].includes(
              action.textTransform ?? "",
            );
            return (
              <div key={index} className={styles.ruleRow}>
                <span className={styles.ruleLabel}>Action {index + 1}</span>

                <select
                  aria-label={`Action ${index + 1} field`}
                  className={styles.select}
                  value={action.field}
                  onChange={(event) => {
                    const selected =
                      actionFields.find(
                        (item) => item.value === event.currentTarget.value,
                      ) ?? actionFields[0];
                    updateAction(index, defaultAction([selected]));
                  }}
                >
                  {actionFields.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`Action ${index + 1} operation`}
                  className={styles.select}
                  value={action.operation}
                  onChange={(event) =>
                    updateAction(index, {
                      operation: event.currentTarget
                        .value as EditAction["operation"],
                      value: "",
                      find: undefined,
                      replace: undefined,
                      regexFlags: undefined,
                      textTransform: undefined,
                    })
                  }
                >
                  {available.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                {isFindReplace && (
                  <>
                    <input
                      aria-label={
                        action.operation === "regex_replace"
                          ? "Regex pattern"
                          : "Find text"
                      }
                      className={styles.input}
                      value={action.find ?? ""}
                      placeholder={
                        action.operation === "regex_replace"
                          ? "RE2 pattern"
                          : "Find"
                      }
                      onChange={(event) =>
                        updateAction(index, {
                          find: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Replacement"
                      className={styles.input}
                      value={action.replace ?? ""}
                      placeholder="Replace with; use $1 for capture groups"
                      onChange={(event) =>
                        updateAction(index, {
                          replace: event.currentTarget.value,
                        })
                      }
                    />
                    {action.operation === "regex_replace" && (
                      <select
                        aria-label="Regex flags"
                        className={styles.select}
                        value={action.regexFlags ?? "g"}
                        onChange={(event) =>
                          updateAction(index, {
                            regexFlags: event.currentTarget.value,
                          })
                        }
                      >
                        <option value="">First, case-sensitive</option>
                        <option value="i">First, ignore case</option>
                        <option value="g">All, case-sensitive</option>
                        <option value="gi">All, ignore case</option>
                      </select>
                    )}
                  </>
                )}

                {isTextTransform && (
                  <>
                    <select
                      aria-label="Text transform"
                      className={styles.select}
                      value={action.textTransform ?? "trim"}
                      onChange={(event) =>
                        updateAction(index, {
                          textTransform: event.currentTarget
                            .value as TextTransform,
                        })
                      }
                    >
                      {TEXT_TRANSFORMS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {needsTransformValue && (
                      <input
                        aria-label="Transform value"
                        className={styles.input}
                        value={String(action.value ?? "")}
                        placeholder={
                          action.textTransform === "template"
                            ? "{{title}} | {{vendor}}"
                            : "Text"
                        }
                        onChange={(event) =>
                          updateAction(index, {
                            value: event.currentTarget.value,
                          })
                        }
                      />
                    )}
                  </>
                )}

                {!isFindReplace && !isTextTransform && !isClear && (
                  <input
                    aria-label={`Action ${index + 1} value`}
                    className={styles.input}
                    type={field?.kind === "number" ? "number" : "text"}
                    value={String(action.value ?? "")}
                    placeholder="Value"
                    onChange={(event) =>
                      updateAction(index, {
                        value: event.currentTarget.value,
                      })
                    }
                  />
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={index === 0}
                    onClick={() => moveAction(index, -1)}
                    aria-label="Move action up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={index === actions.length - 1}
                    onClick={() => moveAction(index, 1)}
                    aria-label="Move action down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={actions.length === 1}
                    onClick={() =>
                      setActions((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className={styles.addButton}
            onClick={() =>
              setActions((items) => [...items, defaultAction(actionFields)])
            }
          >
            + Add action
          </button>
        </div>
      </s-section>
    </>
  );
}
