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

describe("matchesVariantTarget — product-level field filtering", () => {
  const variantWithProduct = {
    id: "gid://shopify/ProductVariant/10",
    title: "Blue / Large",
    sku: "NIKE-BL",
    price: "99.00",
    taxable: true,
    inventoryPolicy: "CONTINUE",
    inventoryQuantity: 5,
    product: {
      id: "gid://shopify/Product/100",
      title: "Air Max",
      vendor: "Nike",
      productType: "Shoes",
      status: "ACTIVE",
      tags: ["running", "sale"],
      handle: "air-max",
    },
  };

  it("filters by productTitle", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productTitle", operator: "contains", value: "Air" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productTitle", operator: "equals", value: "Other" }],
      }),
    ).toBe(false);
  });

  it("filters by productVendor", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productVendor", operator: "equals", value: "Nike" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productVendor", operator: "equals", value: "Adidas" }],
      }),
    ).toBe(false);
  });

  it("filters by productType", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productType", operator: "starts_with", value: "Shoe" }],
      }),
    ).toBe(true);
  });

  it("filters by productStatus", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productStatus", operator: "equals", value: "ACTIVE" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productStatus", operator: "equals", value: "DRAFT" }],
      }),
    ).toBe(false);
  });

  it("filters by productTags (any match)", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productTags", operator: "in_list", values: ["sale"] }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productTags", operator: "equals", value: "clearance" }],
      }),
    ).toBe(false);
  });

  it("filters by productHandle", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [{ field: "productHandle", operator: "starts_with", value: "air" }],
      }),
    ).toBe(true);
  });

  it("combines variant and product-level filters with AND", () => {
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [
          { field: "productVendor", operator: "equals", value: "Nike" },
          { field: "price", operator: "less_than", value: 150 },
          { field: "inventoryPolicy", operator: "equals", value: "CONTINUE" },
        ],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantWithProduct, {
        combinator: "and",
        conditions: [
          { field: "productVendor", operator: "equals", value: "Nike" },
          { field: "price", operator: "greater_than", value: 150 },
        ],
      }),
    ).toBe(false);
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

describe("matchesVariantTarget — extended product-level fields", () => {
  const variantFull = {
    id: "gid://shopify/ProductVariant/20",
    sku: "XT-1",
    price: "50.00",
    taxable: false,
    inventoryPolicy: "DENY",
    inventoryQuantity: 3,
    product: {
      id: "gid://shopify/Product/200",
      title: "Xtreme Tee",
      vendor: "Acme",
      productType: "T-Shirt",
      status: "ACTIVE",
      tags: ["summer"],
      handle: "xtreme-tee",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      publishedAt: "2026-02-01T00:00:00Z",
      totalInventory: 30,
      hasOnlyDefaultVariant: false,
      isGiftCard: false,
      requiresSellingPlan: false,
      collections: { nodes: [{ id: "gid://shopify/Collection/42" }] },
    },
  };

  it("filters by productCollectionId", () => {
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productCollectionId", operator: "equals", value: "42" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productCollectionId", operator: "equals", value: "99" }],
      }),
    ).toBe(false);
  });

  it("derives productPublishedStatus from publishedAt", () => {
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productPublishedStatus", operator: "equals", value: "published" }],
      }),
    ).toBe(true);
    const unpublished = { ...variantFull, product: { ...variantFull.product, publishedAt: null } };
    expect(
      matchesVariantTarget(unpublished, {
        combinator: "and",
        conditions: [{ field: "productPublishedStatus", operator: "equals", value: "unpublished" }],
      }),
    ).toBe(true);
  });

  it("filters by productTotalInventory", () => {
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productTotalInventory", operator: "greater_than", value: 10 }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productTotalInventory", operator: "less_than", value: 10 }],
      }),
    ).toBe(false);
  });

  it("filters by productHasOnlyDefaultVariant", () => {
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productHasOnlyDefaultVariant", operator: "equals", value: "false" }],
      }),
    ).toBe(true);
  });

  it("filters by productCreatedAt and productUpdatedAt", () => {
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productCreatedAt", operator: "before", value: "2026-06-01" }],
      }),
    ).toBe(true);
    expect(
      matchesVariantTarget(variantFull, {
        combinator: "and",
        conditions: [{ field: "productUpdatedAt", operator: "after", value: "2026-01-01" }],
      }),
    ).toBe(true);
  });
});
