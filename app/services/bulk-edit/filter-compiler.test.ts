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
