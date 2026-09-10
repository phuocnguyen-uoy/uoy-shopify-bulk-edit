import { describe, expect, it } from "vitest";
import { compileProductSearch } from "./filter-compiler";

describe("compileProductSearch", () => {
  it("compiles and escapes product filters", () => {
    expect(
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [
          { field: "vendor", operator: "equals", value: 'ACME "West"' },
          { field: "price", operator: "greater_than", value: 20 },
        ],
      }),
    ).toBe('(vendor:"ACME \\"West\\"") AND (price:>20)');
  });

  it("rejects unsupported fields", () => {
    expect(() =>
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [{ field: "secret", operator: "equals", value: "x" }],
      }),
    ).toThrow("Unsupported product field");
  });
});

it("uses a broad candidate query for substring matching", () => {
  expect(
    compileProductSearch("PRODUCT", {
      combinator: "and",
      conditions: [
        {
          field: "vendor",
          operator: "contains",
          value: "acme) OR title:*",
        },
      ],
    }),
  ).toBe("(vendor:*)");
});

it("uses an unfiltered candidate query for negative substring matching", () => {
  expect(
    compileProductSearch("PRODUCT", {
      combinator: "and",
      conditions: [{ field: "title", operator: "not_contains", value: "bc" }],
    }),
  ).toBe("");
});

describe("collection filters", () => {
  it("compiles title and handle filters", () => {
    expect(
      compileProductSearch("COLLECTION", {
        combinator: "and",
        conditions: [
          { field: "title", operator: "equals", value: "Summer" },
          { field: "handle", operator: "contains", value: "sale" },
        ],
      }),
    ).toBe('(title:"Summer") AND (handle:*)');
  });

  it("rejects product-only fields", () => {
    expect(() =>
      compileProductSearch("COLLECTION", {
        combinator: "and",
        conditions: [{ field: "vendor", operator: "equals", value: "ACME" }],
      }),
    ).toThrow("Unsupported collection field");
  });
});

describe("VARIANT filter compilation", () => {
  it("compiles sku equals and price range", () => {
    expect(
      compileProductSearch("VARIANT", {
        combinator: "and",
        conditions: [
          { field: "sku", operator: "starts_with", value: "TS-" },
          { field: "price", operator: "less_than", value: 50 },
        ],
      }),
    ).toBe('(sku:"TS-*") AND (price:<50)');
  });

  it("uses broad query for contains on title", () => {
    expect(
      compileProductSearch("VARIANT", {
        combinator: "and",
        conditions: [{ field: "title", operator: "contains", value: "Red" }],
      }),
    ).toBe("(title:*)");
  });
});

describe("advanced filter operators", () => {
  it("compiles prefix, lists, ranges, and dates", () => {
    expect(
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [
          { field: "sku", operator: "starts_with", value: "ABC-" },
          { field: "vendor", operator: "in_list", values: ["ACME", "Other"] },
          { field: "price", operator: "between", value: 10, valueTo: 50 },
          { field: "createdAt", operator: "after", value: "2026-01-01" },
        ],
      }),
    ).toBe(
      '(sku:"ABC-*") AND (vendor:"ACME" OR vendor:"Other") AND (price:>=10 AND price:<=50) AND (created_at:>"2026-01-01")',
    );
  });

  it("uses a broad candidate query for suffix matching", () => {
    expect(
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [
          { field: "handle", operator: "ends_with", value: "-sale" },
        ],
      }),
    ).toBe("(handle:*)");
  });

  it("rejects empty lists and incomplete ranges", () => {
    expect(() =>
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [{ field: "vendor", operator: "in_list", values: [] }],
      }),
    ).toThrow("requires at least one value");
    expect(() =>
      compileProductSearch("PRODUCT", {
        combinator: "and",
        conditions: [{ field: "price", operator: "between", value: 10 }],
      }),
    ).toThrow("lower and upper bounds");
  });
});
