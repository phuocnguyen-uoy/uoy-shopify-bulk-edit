import { describe, expect, it } from "vitest";
import { applyActions } from "./transform";

describe("applyActions", () => {
  it("does not mutate the snapshot", () => {
    const before = { title: "Old title", tags: ["sale"], vendor: "ACME" };
    const after = applyActions("PRODUCT", before, [
      { field: "title", operation: "find_replace", find: "Old", replace: "New" },
      { field: "tags", operation: "add", value: "featured" },
    ]);
    expect(after).toEqual({ title: "New title", tags: ["sale", "featured"], vendor: "ACME" });
    expect(before).toEqual({ title: "Old title", tags: ["sale"], vendor: "ACME" });
  });

  it("finds and replaces text case-insensitively", () => {
    expect(applyActions("PRODUCT", { title: "Women's Women" }, [
      { field: "title", operation: "find_replace", find: "women", replace: "men" },
    ])).toEqual({ title: "men's men" });
  });

  it("treats regex characters in find text literally", () => {
    expect(applyActions("PRODUCT", { title: "Size (M) + bonus" }, [
      { field: "title", operation: "find_replace", find: "(M) +", replace: "L" },
    ])).toEqual({ title: "Size L bonus" });
  });

  it("adjusts variant prices", () => {
    expect(applyActions("VARIANT", { price: 19.99 }, [
      { field: "price", operation: "increase_percent", value: 10 },
    ])).toEqual({ price: 21.99 });
  });

  it("adjusts namespaced variant prices in the Products workflow", () => {
    expect(applyActions("PRODUCT", { variantPrice: "19.99" }, [
      { field: "variantPrice", operation: "increase_percent", value: 10 },
    ])).toEqual({ variantPrice: "21.99" });
  });

  it("rejects read-only fields", () => {
    expect(() => applyActions("PRODUCT", { price: 10 }, [
      { field: "price", operation: "set", value: 20 },
    ])).toThrow("Field is read-only");
  });
});

it("prevents negative prices and preserves decimal strings", () => {
  expect(applyActions("VARIANT", { price: "10.00" }, [
    { field: "price", operation: "decrease_percent", value: 150 },
  ])).toEqual({ price: "0.00" });
});
