import { describe, expect, it } from "vitest";
import { detectMapping, KDC_MAPPING } from "../app/services/mapping.server";

describe("column mapping", () => {
  it("detects the actual KDC Matrixify-style columns", () => {
    const headers = [
      "Command",
      "Name",
      "Customer: Email",
      "Payment: Status",
      "Line: Title",
      "Line: SKU",
      "Line: Image",
      "Line: Variant ID",
      "Line: Price",
      "Line: Quantity",
      "Processed At",
      "Currency",
    ];
    expect(detectMapping(headers)).toMatchObject(KDC_MAPPING);
  });

  it("does not confuse a variant ID with an order ID", () => {
    const result = detectMapping(["Name", "Line: Variant ID"]);
    expect(result.orderId).toBeUndefined();
    expect(result.variantId).toBe("Line: Variant ID");
  });
});
