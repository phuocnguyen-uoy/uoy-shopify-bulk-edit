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

describe("product collection filters", () => {
  it("matches a product in any selected collection", () => {
    expect(compileProductSearch("PRODUCT", {
      combinator: "and",
      conditions: [{ field: "collectionId", operator: "equals", value: "123,456" }],
    })).toBe('((collection_id:"123" OR collection_id:"456"))');
  });

  it("excludes products in every selected collection", () => {
    expect(compileProductSearch("PRODUCT", {
      combinator: "and",
      conditions: [{ field: "collectionId", operator: "not_equals", value: "123,456" }],
    })).toBe('((-collection_id:"123" AND -collection_id:"456"))');
  });

  it("rejects malformed collection IDs", () => {
    expect(() => compileProductSearch("PRODUCT", {
      combinator: "and",
      conditions: [{ field: "collectionId", operator: "equals", value: "123,nope" }],
    })).toThrow("numeric collection IDs");
  });
});


describe("collection filters", () => {
  it("compiles title and handle filters", () => {
    expect(compileProductSearch("COLLECTION", {
      combinator: "and",
      conditions: [
        { field: "title", operator: "equals", value: "Summer" },
        { field: "handle", operator: "contains", value: "sale" },
      ],
    })).toBe('(title:"Summer") AND (handle:*)');
  });

  it("rejects product-only fields", () => {
    expect(() => compileProductSearch("COLLECTION", {
      combinator: "and",
      conditions: [{ field: "vendor", operator: "equals", value: "ACME" }],
    })).toThrow("Unsupported collection field");
  });
});
