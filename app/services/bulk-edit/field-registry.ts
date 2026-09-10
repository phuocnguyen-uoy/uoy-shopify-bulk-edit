import type { ResourceType } from "@prisma/client";
import type { FilterOperator } from "../tasks/types";

type FieldKind = "string" | "number" | "boolean" | "string_list";

export type FieldDefinition = {
  kind: FieldKind;
  searchKey?: string;
  filterOperators: readonly FilterOperator[];
  editable: boolean;
  variantScope?: boolean;
};

const textOperators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in_list",
  "not_in_list",
  "is_empty",
  "is_not_empty",
] as const;
const numberOperators = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "between",
  "in_list",
  "is_empty",
  "is_not_empty",
] as const;

export const fieldRegistry: Record<
  ResourceType,
  Record<string, FieldDefinition>
> = {
  PRODUCT: {
    title: {
      kind: "string",
      searchKey: "title",
      filterOperators: textOperators,
      editable: true,
    },
    descriptionHtml: {
      kind: "string",
      filterOperators: textOperators,
      editable: true,
    },
    vendor: {
      kind: "string",
      searchKey: "vendor",
      filterOperators: textOperators,
      editable: true,
    },
    productType: {
      kind: "string",
      searchKey: "product_type",
      filterOperators: textOperators,
      editable: true,
    },
    status: {
      kind: "string",
      searchKey: "status",
      filterOperators: ["equals", "not_equals"],
      editable: true,
    },
    tags: {
      kind: "string_list",
      searchKey: "tag",
      filterOperators: textOperators,
      editable: true,
    },
    collectionId: {
      kind: "string",
      searchKey: "collection_id",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    totalInventory: {
      kind: "number",
      searchKey: "inventory_total",
      filterOperators: numberOperators,
      editable: false,
    },
    sku: {
      kind: "string",
      searchKey: "sku",
      filterOperators: textOperators,
      editable: false,
    },
    barcode: {
      kind: "string",
      searchKey: "barcode",
      filterOperators: textOperators,
      editable: false,
    },
    price: {
      kind: "number",
      searchKey: "price",
      filterOperators: numberOperators,
      editable: false,
    },
    handle: {
      kind: "string",
      searchKey: "handle",
      filterOperators: textOperators,
      editable: true,
    },
    templateSuffix: {
      kind: "string",
      filterOperators: textOperators,
      editable: true,
    },
    seoTitle: { kind: "string", filterOperators: [], editable: true },
    seoDescription: { kind: "string", filterOperators: [], editable: true },
    createdAt: {
      kind: "string",
      searchKey: "created_at",
      filterOperators: [
        "greater_than",
        "less_than",
        "before",
        "after",
        "between",
      ],
      editable: false,
    },
    updatedAt: {
      kind: "string",
      searchKey: "updated_at",
      filterOperators: [
        "greater_than",
        "less_than",
        "before",
        "after",
        "between",
      ],
      editable: false,
    },
    publishedAt: {
      kind: "string",
      searchKey: "published_at",
      filterOperators: [
        "greater_than",
        "less_than",
        "before",
        "after",
        "between",
      ],
      editable: false,
    },
    publishedStatus: {
      kind: "string",
      searchKey: "published_status",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    hasOnlyDefaultVariant: {
      kind: "boolean",
      searchKey: "has_only_default_variant",
      filterOperators: ["equals"],
      editable: false,
    },
    isGiftCard: {
      kind: "boolean",
      searchKey: "gift_card",
      filterOperators: ["equals"],
      editable: false,
    },
    variantsCount: {
      kind: "number",
      searchKey: "variants_count",
      filterOperators: numberOperators,
      editable: false,
    },
    hasOutOfStockVariants: {
      kind: "boolean",
      searchKey: "out_of_stock_products",
      filterOperators: ["equals"],
      editable: false,
    },
    requiresSellingPlan: {
      kind: "boolean",
      searchKey: "requires_selling_plan",
      filterOperators: ["equals"],
      editable: false,
    },
    variantTitle: {
      kind: "string",
      searchKey: "variant_title",
      filterOperators: textOperators,
      editable: false,
      variantScope: true,
    },
    variantTaxable: {
      kind: "boolean",
      searchKey: "taxable",
      filterOperators: ["equals", "not_equals"],
      editable: true,
      variantScope: true,
    },
    // Variant action fields supported by productVariantsBulkUpdate.
    variantPrice: {
      kind: "number",
      filterOperators: [],
      editable: true,
      variantScope: true,
    },
    variantCompareAtPrice: {
      kind: "number",
      filterOperators: [],
      editable: true,
      variantScope: true,
    },
    variantSku: {
      kind: "string",
      filterOperators: [],
      editable: true,
      variantScope: true,
    },
    variantBarcode: {
      kind: "string",
      filterOperators: [],
      editable: true,
      variantScope: true,
    },
    variantWeight: { kind: "number", filterOperators: [], editable: false },
    variantWeightUnit: { kind: "string", filterOperators: [], editable: false },
    variantRequiresShipping: {
      kind: "boolean",
      filterOperators: [],
      editable: false,
    },
    variantInventoryPolicy: {
      kind: "string",
      filterOperators: [],
      editable: true,
      variantScope: true,
    },
    variantCostPerItem: {
      kind: "number",
      filterOperators: [],
      editable: false,
    },
  },
  VARIANT: {
    // Variant-level fields
    title: {
      kind: "string",
      searchKey: "title",
      filterOperators: textOperators,
      editable: false,
    },
    sku: {
      kind: "string",
      searchKey: "sku",
      filterOperators: textOperators,
      editable: true,
    },
    barcode: {
      kind: "string",
      searchKey: "barcode",
      filterOperators: textOperators,
      editable: true,
    },
    price: {
      kind: "number",
      searchKey: "price",
      filterOperators: numberOperators,
      editable: true,
    },
    compareAtPrice: {
      kind: "number",
      searchKey: "compare_at_price",
      filterOperators: numberOperators,
      editable: true,
    },
    taxable: {
      kind: "boolean",
      searchKey: "taxable",
      filterOperators: ["equals", "not_equals"],
      editable: true,
    },
    inventoryPolicy: {
      kind: "string",
      searchKey: "inventory_policy",
      filterOperators: ["equals", "not_equals"],
      editable: true,
    },
    inventoryQuantity: {
      kind: "number",
      searchKey: "inventory_quantity",
      filterOperators: numberOperators,
      editable: false,
    },
    weight: {
      kind: "number",
      filterOperators: numberOperators,
      editable: false,
    },
    weightUnit: {
      kind: "string",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    requiresShipping: {
      kind: "boolean",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    costPerItem: {
      kind: "number",
      filterOperators: numberOperators,
      editable: false,
    },
    // Product-level fields — filter traverses parent product; actions update the parent product
    productTitle: {
      kind: "string",
      searchKey: "product_title",
      filterOperators: textOperators,
      editable: true,
    },
    productVendor: {
      kind: "string",
      searchKey: "vendor",
      filterOperators: textOperators,
      editable: true,
    },
    productType: {
      kind: "string",
      searchKey: "product_type",
      filterOperators: textOperators,
      editable: true,
    },
    productStatus: {
      kind: "string",
      searchKey: "status",
      filterOperators: ["equals", "not_equals"],
      editable: true,
    },
    productTags: {
      kind: "string_list",
      searchKey: "tag",
      filterOperators: textOperators,
      editable: true,
    },
    productHandle: {
      kind: "string",
      searchKey: "handle",
      filterOperators: textOperators,
      editable: true,
    },
    // Product action-only fields (no searchKey — use action scope only)
    productDescriptionHtml: { kind: "string", filterOperators: [], editable: true },
    productSeoTitle: { kind: "string", filterOperators: [], editable: true },
    productSeoDescription: { kind: "string", filterOperators: [], editable: true },
    productTemplateSuffix: { kind: "string", filterOperators: [], editable: true },
    // Product filter-only fields (read-only — for filtering variants by parent product attributes)
    productCollectionId: {
      kind: "string",
      searchKey: "collection_id",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    productPublishedStatus: {
      kind: "string",
      searchKey: "published_status",
      filterOperators: ["equals", "not_equals"],
      editable: false,
    },
    productPublishedAt: {
      kind: "string",
      searchKey: "published_at",
      filterOperators: ["greater_than", "less_than", "before", "after", "between"],
      editable: false,
    },
    productCreatedAt: {
      kind: "string",
      searchKey: "created_at",
      filterOperators: ["greater_than", "less_than", "before", "after", "between"],
      editable: false,
    },
    productUpdatedAt: {
      kind: "string",
      searchKey: "updated_at",
      filterOperators: ["greater_than", "less_than", "before", "after", "between"],
      editable: false,
    },
    productTotalInventory: {
      kind: "number",
      searchKey: "inventory_total",
      filterOperators: numberOperators,
      editable: false,
    },
    productHasOnlyDefaultVariant: {
      kind: "boolean",
      searchKey: "has_only_default_variant",
      filterOperators: ["equals"],
      editable: false,
    },
    productIsGiftCard: {
      kind: "boolean",
      searchKey: "gift_card",
      filterOperators: ["equals"],
      editable: false,
    },
    productRequiresSellingPlan: {
      kind: "boolean",
      searchKey: "requires_selling_plan",
      filterOperators: ["equals"],
      editable: false,
    },
  },
  COLLECTION: {
    title: {
      kind: "string",
      searchKey: "title",
      filterOperators: textOperators,
      editable: true,
    },
    descriptionHtml: {
      kind: "string",
      filterOperators: textOperators,
      editable: true,
    },
    handle: {
      kind: "string",
      searchKey: "handle",
      filterOperators: textOperators,
      editable: true,
    },
  },
};

export function requireField(resource: ResourceType, field: string) {
  const definition = fieldRegistry[resource][field];
  if (!definition)
    throw new Error(`Unsupported ${resource.toLowerCase()} field: ${field}`);
  return definition;
}
