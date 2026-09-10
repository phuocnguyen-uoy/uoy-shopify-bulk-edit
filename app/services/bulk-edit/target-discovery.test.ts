import { describe, expect, it } from "vitest";
import { matchesTarget, matchesVariantTarget } from "./target-discovery.server";

describe("target discovery exact filtering", () => {
  const product = {
    id: "gid://shopify/Product/1",
    title: "Summer Shoe Sale",
    vendor: "ACME",
    handle: "summer-shoe-sale",
    tags: ["summer", "sale"],
    totalInventory: 12,
    publishedAt: "2026-01-10T00:00:00Z",
    collections: { nodes: [{ id: "gid://shopify/Collection/99" }] },
    variants: {
      nodes: [
        { sku: "ABC-1", price: "100.00", taxable: true, inventoryQuantity: 0 },
        { sku: "XYZ-2", price: "25.00", taxable: false, inventoryQuantity: 4 },
      ],
    },
  };

  it("evaluates AND conditions across scalar and variant fields", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [
          { field: "title", operator: "ends_with", value: "sale" },
          { field: "sku", operator: "starts_with", value: "ABC" },
          { field: "price", operator: "between", value: 50, valueTo: 150 },
          { field: "collectionId", operator: "equals", value: "99" },
        ],
      }),
    ).toBe(true);
  });

  it("uses numeric rather than lexicographic comparisons", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "price", operator: "greater_than", value: 90 }],
      }),
    ).toBe(true);
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "price", operator: "less_than", value: 20 }],
      }),
    ).toBe(false);
  });

  it("evaluates OR and negative variant predicates correctly", () => {
    expect(
      matchesTarget(product, {
        combinator: "or",
        conditions: [
          { field: "vendor", operator: "equals", value: "Other" },
          { field: "tags", operator: "in_list", values: ["sale"] },
        ],
      }),
    ).toBe(true);
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "sku", operator: "not_contains", value: "ABC" }],
      }),
    ).toBe(false);
  });
});

describe("variantTitle filtering", () => {
  const product = {
    id: "gid://shopify/Product/2",
    title: "T-Shirt",
    variants: {
      nodes: [
        { title: "Red / Small", sku: "TS-R-S" },
        { title: "Blue / Large", sku: "TS-B-L" },
      ],
    },
  };

  it("matches when any variant title contains the value", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "contains", value: "Red" }],
      }),
    ).toBe(true);
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "contains", value: "Green" }],
      }),
    ).toBe(false);
  });

  it("not_contains passes only when ALL variant titles exclude the value", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "not_contains", value: "Green" }],
      }),
    ).toBe(true);
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "not_contains", value: "Red" }],
      }),
    ).toBe(false);
  });

  it("equals matches any variant title exactly (case-insensitive)", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "equals", value: "Blue / Large" }],
      }),
    ).toBe(true);
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "equals", value: "Purple" }],
      }),
    ).toBe(false);
  });

  it("starts_with matches variant title prefix", () => {
    expect(
      matchesTarget(product, {
        combinator: "and",
        conditions: [{ field: "variantTitle", operator: "starts_with", value: "Blue" }],
      }),
    ).toBe(true);
  });
});

describe("matchesVariantTarget — direct variant node filtering", () => {
  const redSmall = {
    id: "gid://shopify/ProductVariant/1",
    title: "Red / Small",
    sku: "TS-R-S",
    barcode: "0001",
    price: "25.00",
    compareAtPrice: "30.00",
    taxable: true,
    inventoryPolicy: "DENY",
    inventoryQuantity: 0,
  };

  it("matches string fields on the variant node directly", () => {
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "sku", operator: "starts_with", value: "TS" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "sku", operator: "equals", value: "XYZ" }],
      }),
    ).toBe(false);
  });

  it("matches numeric price field", () => {
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "price", operator: "less_than", value: 50 }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "price", operator: "greater_than", value: 50 }],
      }),
    ).toBe(false);
  });

  it("matches boolean taxable field", () => {
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "taxable", operator: "equals", value: "true" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "taxable", operator: "not_equals", value: "true" }],
      }),
    ).toBe(false);
  });

  it("matches is_empty / is_not_empty on optional fields", () => {
    const noBarcode = { ...redSmall, barcode: null };
    expect(
      matchesVariantTarget(noBarcode, {
        combinator: "and",
        conditions: [{ field: "barcode", operator: "is_empty", value: "" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [{ field: "barcode", operator: "is_not_empty", value: "" }],
      }),
    ).toBe(true);
  });

  it("combines AND conditions correctly", () => {
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [
          { field: "title", operator: "contains", value: "Red" },
          { field: "price", operator: "less_than", value: 50 },
        ],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(redSmall, {
        combinator: "and",
        conditions: [
          { field: "title", operator: "contains", value: "Blue" },
          { field: "price", operator: "less_than", value: 50 },
        ],
      }),
    ).toBe(false);
  });
});
