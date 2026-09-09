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
  "equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty",
] as const;
const numberOperators = [
  "equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty",
] as const;

export const fieldRegistry: Record<ResourceType, Record<string, FieldDefinition>> = {
  PRODUCT: {
    title: { kind: "string", searchKey: "title", filterOperators: textOperators, editable: true },
    descriptionHtml: { kind: "string", filterOperators: textOperators, editable: true },
    vendor: { kind: "string", searchKey: "vendor", filterOperators: textOperators, editable: true },
    productType: { kind: "string", searchKey: "product_type", filterOperators: textOperators, editable: true },
    status: { kind: "string", searchKey: "status", filterOperators: ["equals", "not_equals"], editable: true },
    tags: { kind: "string_list", searchKey: "tag", filterOperators: textOperators, editable: true },
    collectionId: { kind: "string", searchKey: "collection_id", filterOperators: ["equals", "not_equals"], editable: false },
    totalInventory: { kind: "number", searchKey: "inventory_total", filterOperators: numberOperators, editable: false },
    sku: { kind: "string", searchKey: "sku", filterOperators: textOperators, editable: false },
    barcode: { kind: "string", searchKey: "barcode", filterOperators: textOperators, editable: false },
    price: { kind: "number", searchKey: "price", filterOperators: numberOperators, editable: false },
    handle: { kind: "string", searchKey: "handle", filterOperators: textOperators, editable: true },
    templateSuffix: { kind: "string", filterOperators: textOperators, editable: true },
    seoTitle: { kind: "string", filterOperators: [], editable: true },
    seoDescription: { kind: "string", filterOperators: [], editable: true },
    createdAt: { kind: "string", searchKey: "created_at", filterOperators: ["greater_than", "less_than"], editable: false },
    updatedAt: { kind: "string", searchKey: "updated_at", filterOperators: ["greater_than", "less_than"], editable: false },
    publishedAt: { kind: "string", searchKey: "published_at", filterOperators: ["greater_than", "less_than"], editable: false },
    publishedStatus: { kind: "string", searchKey: "published_status", filterOperators: ["equals", "not_equals"], editable: false },
    hasOnlyDefaultVariant: { kind: "boolean", searchKey: "has_only_default_variant", filterOperators: ["equals"], editable: false },
    isGiftCard: { kind: "boolean", searchKey: "gift_card", filterOperators: ["equals"], editable: false },
    variantsCount: { kind: "number", searchKey: "variants_count", filterOperators: numberOperators, editable: false },
    hasOutOfStockVariants: { kind: "boolean", searchKey: "out_of_stock_products", filterOperators: ["equals"], editable: false },
    requiresSellingPlan: { kind: "boolean", searchKey: "requires_selling_plan", filterOperators: ["equals"], editable: false },
    variantTaxable: { kind: "boolean", searchKey: "taxable", filterOperators: ["equals", "not_equals"], editable: true, variantScope: true },
    // Variant action fields supported by productVariantsBulkUpdate.
    variantPrice: { kind: "number", filterOperators: [], editable: true, variantScope: true },
    variantCompareAtPrice: { kind: "number", filterOperators: [], editable: true, variantScope: true },
    variantSku: { kind: "string", filterOperators: [], editable: true, variantScope: true },
    variantBarcode: { kind: "string", filterOperators: [], editable: true, variantScope: true },
    variantWeight: { kind: "number", filterOperators: [], editable: false },
    variantWeightUnit: { kind: "string", filterOperators: [], editable: false },
    variantRequiresShipping: { kind: "boolean", filterOperators: [], editable: false },
    variantInventoryPolicy: { kind: "string", filterOperators: [], editable: true, variantScope: true },
    variantCostPerItem: { kind: "number", filterOperators: [], editable: false },
  },
  VARIANT: {
    title: { kind: "string", searchKey: "title", filterOperators: textOperators, editable: false },
    sku: { kind: "string", searchKey: "sku", filterOperators: textOperators, editable: true },
    barcode: { kind: "string", searchKey: "barcode", filterOperators: textOperators, editable: true },
    price: { kind: "number", searchKey: "price", filterOperators: numberOperators, editable: true },
    compareAtPrice: { kind: "number", filterOperators: numberOperators, editable: true },
    taxable: { kind: "boolean", searchKey: "taxable", filterOperators: ["equals", "not_equals"], editable: true },
    weight: { kind: "number", filterOperators: numberOperators, editable: true },
    weightUnit: { kind: "string", filterOperators: ["equals", "not_equals"], editable: true },
    inventoryPolicy: { kind: "string", filterOperators: ["equals", "not_equals"], editable: true },
    requiresShipping: { kind: "boolean", filterOperators: ["equals", "not_equals"], editable: true },
    inventoryQuantity: { kind: "number", filterOperators: numberOperators, editable: false },
    costPerItem: { kind: "number", filterOperators: numberOperators, editable: true },
  },
  COLLECTION: {
    title: { kind: "string", searchKey: "title", filterOperators: textOperators, editable: true },
    handle: { kind: "string", searchKey: "handle", filterOperators: textOperators, editable: true },
    descriptionHtml: { kind: "string", filterOperators: [], editable: true },
    seoTitle: { kind: "string", filterOperators: [], editable: true },
    seoDescription: { kind: "string", filterOperators: [], editable: true },
    templateSuffix: { kind: "string", filterOperators: [], editable: true },
    updatedAt: { kind: "string", searchKey: "updated_at", filterOperators: ["greater_than", "less_than"], editable: false },
  },
};

export function requireField(resource: ResourceType, field: string) {
  const definition = fieldRegistry[resource][field];
  if (!definition) throw new Error(`Unsupported ${resource.toLowerCase()} field: ${field}`);
  return definition;
}
