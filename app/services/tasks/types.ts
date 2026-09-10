export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty"
  | "starts_with"
  | "ends_with"
  | "in_list"
  | "not_in_list"
  | "between"
  | "before"
  | "after";

export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value?: string | number | boolean;
  valueTo?: string | number;
  values?: string[];
};

export type FilterDefinition = {
  combinator: "and" | "or";
  conditions: FilterCondition[];
};

export type EditAction = {
  field: string;
  operation:
    | "set"
    | "clear"
    | "find_replace"
    | "regex_replace"
    | "text_transform"
    | "add"
    | "remove"
    | "increase_fixed"
    | "increase_percent"
    | "decrease_fixed"
    | "decrease_percent";
  value?: string | number | boolean;
  find?: string;
  replace?: string;
  regexFlags?: string;
  textTransform?: TextTransform;
};

export type TextTransform =
  | "uppercase"
  | "lowercase"
  | "title_case"
  | "sentence_case"
  | "trim"
  | "normalize_whitespace"
  | "remove_html"
  | "remove_emoji"
  | "prefix"
  | "suffix"
  | "template";

export type ActionDefinition = { actions: EditAction[] };
