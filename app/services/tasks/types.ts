export type FilterOperator =
  | "equals" | "not_equals" | "contains" | "not_contains"
  | "greater_than" | "less_than" | "is_empty" | "is_not_empty";

export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value?: string | number | boolean;
};

export type FilterDefinition = {
  combinator: "and" | "or";
  conditions: FilterCondition[];
};

export type EditAction = {
  field: string;
  operation:
    | "set" | "clear" | "find_replace" | "add" | "remove"
    | "increase_fixed" | "increase_percent"
    | "decrease_fixed" | "decrease_percent";
  value?: string | number | boolean;
  find?: string;
  replace?: string;
};

export type ActionDefinition = { actions: EditAction[] };
