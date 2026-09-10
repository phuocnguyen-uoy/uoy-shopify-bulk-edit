import { describe, expect, it } from "vitest";
import { applyActions } from "./transform";

describe("applyActions", () => {
  it("does not mutate the snapshot", () => {
    const before = { title: "Old title", tags: ["sale"], vendor: "ACME" };
    const after = applyActions("PRODUCT", before, [
      {
        field: "title",
        operation: "find_replace",
        find: "Old",
        replace: "New",
      },
      { field: "tags", operation: "add", value: "featured" },
    ]);
    expect(after).toEqual({
      title: "New title",
      tags: ["sale", "featured"],
      vendor: "ACME",
    });
    expect(before).toEqual({
      title: "Old title",
      tags: ["sale"],
      vendor: "ACME",
    });
  });

  it("finds and replaces text case-insensitively", () => {
    expect(
      applyActions("PRODUCT", { title: "Women's Women" }, [
        {
          field: "title",
          operation: "find_replace",
          find: "women",
          replace: "men",
        },
      ]),
    ).toEqual({ title: "men's men" });
  });

  it("treats regex characters in find text literally", () => {
    expect(
      applyActions("PRODUCT", { title: "Size (M) + bonus" }, [
        {
          field: "title",
          operation: "find_replace",
          find: "(M) +",
          replace: "L",
        },
      ]),
    ).toEqual({ title: "Size L bonus" });
  });

  it("adjusts variant prices", () => {
    expect(
      applyActions("VARIANT", { price: 19.99 }, [
        { field: "price", operation: "increase_percent", value: 10 },
      ]),
    ).toEqual({ price: 21.99 });
  });

  it("adjusts namespaced variant prices in the Products workflow", () => {
    expect(
      applyActions("PRODUCT", { variantPrice: "19.99" }, [
        { field: "variantPrice", operation: "increase_percent", value: 10 },
      ]),
    ).toEqual({ variantPrice: "21.99" });
  });

  it("rejects read-only fields", () => {
    expect(() =>
      applyActions("PRODUCT", { price: 10 }, [
        { field: "price", operation: "set", value: 20 },
      ]),
    ).toThrow("Field is read-only");
  });
});

it("prevents negative prices and preserves decimal strings", () => {
  expect(
    applyActions("VARIANT", { price: "10.00" }, [
      { field: "price", operation: "decrease_percent", value: 150 },
    ]),
  ).toEqual({ price: "0.00" });
});

describe("collection actions", () => {
  it("updates editable collection fields", () => {
    expect(
      applyActions("COLLECTION", { title: "Summer", handle: "summer" }, [
        { field: "title", operation: "add", value: " Sale" },
      ]),
    ).toEqual({ title: "Summer Sale", handle: "summer" });
  });

  it("rejects product-only fields", () => {
    expect(() =>
      applyActions("COLLECTION", { vendor: "ACME" }, [
        { field: "vendor", operation: "set", value: "Other" },
      ]),
    ).toThrow("Unsupported collection field");
  });
});

describe("safe regex and text transformations", () => {
  it("replaces capture groups globally with RE2", () => {
    expect(
      applyActions("PRODUCT", { title: "ABC-12 ABC-34" }, [
        {
          field: "title",
          operation: "regex_replace",
          find: "ABC-(\\d+)",
          replace: "SKU-$1",
          regexFlags: "g",
        },
      ]),
    ).toEqual({ title: "SKU-12 SKU-34" });
  });

  it("rejects unsupported backtracking features", () => {
    expect(() =>
      applyActions("PRODUCT", { title: "aaaa" }, [
        {
          field: "title",
          operation: "regex_replace",
          find: "(a+)\\1",
          replace: "x",
          regexFlags: "g",
        },
      ]),
    ).toThrow("Invalid RE2 regex");
  });

  it("runs ordered text actions and templates against the latest snapshot", () => {
    expect(
      applyActions(
        "PRODUCT",
        { title: "  hello world  ", vendor: "ACME", seoTitle: "" },
        [
          {
            field: "title",
            operation: "text_transform",
            textTransform: "trim",
          },
          {
            field: "title",
            operation: "text_transform",
            textTransform: "title_case",
          },
          {
            field: "seoTitle",
            operation: "text_transform",
            textTransform: "template",
            value: "{{title}} | {{vendor}}",
          },
        ],
      ),
    ).toMatchObject({ title: "Hello World", seoTitle: "Hello World | ACME" });
  });
});


describe("collection actions", () => {
  it("updates editable collection fields", () => {
    expect(applyActions("COLLECTION", { title: "Summer", handle: "summer" }, [
      { field: "title", operation: "add", value: " Sale" },
    ])).toEqual({ title: "Summer Sale", handle: "summer" });
  });

  it("rejects product-only fields", () => {
    expect(() => applyActions("COLLECTION", { vendor: "ACME" }, [
      { field: "vendor", operation: "set", value: "Other" },
    ])).toThrow("Unsupported collection field");
  });
});
