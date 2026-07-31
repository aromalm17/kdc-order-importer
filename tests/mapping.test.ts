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

  it("does not use the order Name column as the customer name", () => {
    const result = detectMapping(["Name", "Customer: Email"]);
    expect(result.orderName).toBe("Name");
    expect(result.customerName).toBeUndefined();
  });

  it.each(["Fulfillment Status", "Fulfilment Status"])(
    "detects the fulfillment status column: %s",
    (header) => {
      expect(detectMapping([header]).fulfillmentStatus).toBe(header);
    },
  );

  it.each(["Shipping Charge", "Shipping Price", "Shipping Amount"])(
    "detects the shipping charge column: %s",
    (header) => {
      expect(detectMapping([header]).shippingCharge).toBe(header);
    },
  );
});
