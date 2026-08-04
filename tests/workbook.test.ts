import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  applyVariantImageVerification,
  hasBlockingIssues,
  parseWorkbook,
  rebuildOrderIssues,
  shopifyVariantImageUrlsMatch,
} from "../app/services/workbook.server";

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("workbook parser", () => {
  it("groups multiple rows into one order and keeps all line items", async () => {
    const buffer = await workbookBuffer([
      [
        "Command",
        "Name",
        "Customer: Email",
        "Payment: Status",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
        "Processed At",
        "Currency",
      ],
      [
        "NEW",
        "#1001",
        "buyer@example.com",
        "Paid",
        "Line Item",
        "Car A",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
        "2026-07-01 10:00",
        "INR",
      ],
      [
        "NEW",
        "#1001",
        "",
        "",
        "Line Item",
        "Car B",
        "https://cdn.shopify.com/s/files/1/b.jpg",
        "10002",
        1299,
        2,
        "2026-07-01 10:00",
        "",
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].lineItems).toHaveLength(2);
    expect(parsed.orders[0].customerEmail).toBe("buyer@example.com");
    expect(parsed.orders[0].fulfillmentStatus).toBe("Fulfilled");
    expect(parsed.orders[0].tags).toEqual(["Order Import"]);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(false);
  });

  it("uses only the Order Import tag", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Tags",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1001-TAGS",
        "buyer@example.com",
        "Old Tag, Another Tag",
        "Line Item",
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);

    const parsed = await parseWorkbook(buffer);

    expect(parsed.orders[0].tags).toEqual(["Order Import"]);
  });

  it.each(["", "  FULFILLED  ", "Fulfiled"])(
    "normalizes a blank or completed fulfillment status to Fulfilled: %j",
    async (fulfillmentStatus) => {
      const buffer = await workbookBuffer([
        [
          "Name",
          "Customer: Email",
          "Fulfillment Status",
          "Line: Type",
          "Line: Title",
          "Line: Image",
          "Line: Variant ID",
          "Line: Price",
          "Line: Quantity",
        ],
        [
          "#1001-A",
          "buyer@example.com",
          fulfillmentStatus,
          "Line Item",
          "Car",
          "https://cdn.shopify.com/s/files/1/a.jpg",
          "10001",
          949,
          1,
        ],
      ]);

      const parsed = await parseWorkbook(buffer);

      expect(parsed.orders[0].fulfillmentStatus).toBe("Fulfilled");
      expect(hasBlockingIssues(parsed.orders[0])).toBe(false);
    },
  );

  it.each([
    "Unfulfilled",
    "UN-FULFILLED",
    "unfulfiled",
    "Partially fulfilled",
    "Awaiting shipment",
  ])(
    "blocks an incomplete fulfillment status: %s",
    async (fulfillmentStatus) => {
      const buffer = await workbookBuffer([
        [
          "Name",
          "Customer: Email",
          "Fulfillment Status",
          "Line: Type",
          "Line: Title",
          "Line: Image",
          "Line: Variant ID",
          "Line: Price",
          "Line: Quantity",
        ],
        [
          "#1001-B",
          "buyer@example.com",
          fulfillmentStatus,
          "Line Item",
          "Car",
          "https://cdn.shopify.com/s/files/1/a.jpg",
          "10001",
          949,
          1,
        ],
      ]);

      const parsed = await parseWorkbook(buffer);

      expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
      expect(parsed.orders[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "INCOMPLETE_FULFILLMENT_STATUS",
            field: "fulfillmentStatus",
            severity: "error",
          }),
        ]),
      );
    },
  );

  it("blocks a grouped order when any row is unfulfilled", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Fulfillment Status",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1001-C",
        "buyer@example.com",
        "Fulfilled",
        "Line Item",
        "Car A",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
      [
        "#1001-C",
        "",
        "Unfulfilled",
        "Line Item",
        "Car B",
        "https://cdn.shopify.com/s/files/1/b.jpg",
        "10002",
        1299,
        1,
      ],
    ]);

    const parsed = await parseWorkbook(buffer);

    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].fulfillmentStatus).toBe("Unfulfilled");
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
  });

  it("parses Shipping Charge once for a grouped order", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Shipping Charge",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1001-S",
        "buyer@example.com",
        "₹120.00",
        "Car A",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
      [
        "#1001-S",
        "",
        "",
        "Car B",
        "https://cdn.shopify.com/s/files/1/b.jpg",
        "10002",
        1299,
        1,
      ],
    ]);

    const parsed = await parseWorkbook(buffer);

    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].shippingCharge).toBe(120);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(false);
  });

  it("defaults a missing Shipping Charge to zero", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1001-Z",
        "buyer@example.com",
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);

    const parsed = await parseWorkbook(buffer);

    expect(parsed.orders[0].shippingCharge).toBe(0);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(false);
  });

  it("blocks an invalid Shipping Charge", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Shipping Charge",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1001-I",
        "buyer@example.com",
        -10,
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);

    const parsed = await parseWorkbook(buffer);

    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
    expect(parsed.orders[0].issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_SHIPPING_CHARGE",
        field: "shippingCharge",
      }),
    );
  });

  it("blocks the entire order when a line lacks variant or public image", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1002",
        "buyer@example.com",
        "Line Item",
        "Car A",
        "https://admin.shopify.com/store/kdc/products/1",
        "",
        949,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
    expect(parsed.orders[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MISSING_VARIANT_ID", "INVALID_IMAGE_URL"]),
    );
  });

  it("generates stable order keys from source identity and lines", async () => {
    const rows = [
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1003",
        "buyer@example.com",
        "Line Item",
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ];
    const first = await parseWorkbook(await workbookBuffer(rows));
    const second = await parseWorkbook(await workbookBuffer(rows));
    expect(first.orders[0].deterministicKey).toBe(
      second.orders[0].deterministicKey,
    );
  });

  it("rejects image URLs outside the Shopify files CDN path", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1004",
        "buyer@example.com",
        "Line Item",
        "Car",
        "https://cdn.example.com/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
    expect(parsed.orders[0].issues.map((issue) => issue.code)).toContain(
      "INVALID_IMAGE_URL",
    );
    expect(parsed.orders[0].issues.map((issue) => issue.message)).toContain(
      'The image URL must start with "https://cdn.shopify.com/s/files/".',
    );
  });

  it("composes customer and address data from Matrixify address columns", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Shipping: Name",
        "Shipping: Phone",
        "Shipping: Address 1",
        "Shipping: Address 2",
        "Shipping: City",
        "Shipping: Province",
        "Shipping: Zip",
        "Shipping: Country",
        "Billing: Name",
        "Billing: Address 1",
        "Billing: City",
        "Billing: Zip",
        "Billing: Country",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1005",
        "buyer@example.com",
        "Aromal M",
        "+919645260931",
        "Pavithram",
        "Kaloliparamba",
        "Kozhikode",
        "Kerala",
        "673016",
        "India",
        "Aromal M",
        "Pavithram",
        "Kozhikode",
        "673016",
        "India",
        "Line Item",
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(parsed.orders[0].customerName).toBe("Aromal M");
    expect(parsed.orders[0].customerPhone).toBe("+919645260931");
    expect(parsed.orders[0].shippingAddress).toBe(
      "Aromal M, Pavithram, Kaloliparamba, Kozhikode, Kerala, 673016, India",
    );
    expect(parsed.orders[0].billingAddress).toBe(
      "Aromal M, Pavithram, Kozhikode, 673016, India",
    );
  });

  it("matches the same Shopify CDN asset while ignoring query and fragment", () => {
    expect(
      shopifyVariantImageUrlsMatch(
        "https://cdn.shopify.com/s/files/1/0001/files/car.jpg?v=1785057765#preview",
        "https://cdn.shopify.com/s/files/1/0001/files/car.jpg?v=1785057776&width=800",
      ),
    ).toBe(true);
    expect(
      shopifyVariantImageUrlsMatch(
        "https://cdn.shopify.com/s/files/1/0001/files/car.jpg?v=1",
        "https://cdn.shopify.com/s/files/1/0001/files/other.jpg?v=1",
      ),
    ).toBe(false);
  });

  it("preserves and blocks a valid Excel CDN URL that belongs to another image", async () => {
    const excelImage =
      "https://cdn.shopify.com/s/files/1/0001/files/blue.jpg?v=1";
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1006",
        "buyer@example.com",
        "Line Item",
        "Car",
        excelImage,
        "10001",
        949,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    const line = parsed.orders[0].lineItems[0];

    applyVariantImageVerification(line, {
      title: "Car — Black",
      imageUrls: ["https://cdn.shopify.com/s/files/1/0001/files/black.jpg?v=2"],
      hasUnreadyImage: false,
      isPreorder: false,
    });
    rebuildOrderIssues(parsed.orders[0]);

    expect(line.productTitle).toBe("Car");
    expect(line.imageUrl).toBe(excelImage);
    expect(line.issues.map((issue) => issue.code)).toContain(
      "VARIANT_IMAGE_MISMATCH",
    );
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
  });

  it("does not fill a missing Excel image from Shopify during verification", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      ["#1006A", "buyer@example.com", "Line Item", "Car", "", "10001", 949, 1],
    ]);
    const parsed = await parseWorkbook(buffer);
    const line = parsed.orders[0].lineItems[0];

    applyVariantImageVerification(line, {
      title: "Car — Black",
      imageUrls: ["https://cdn.shopify.com/s/files/1/0001/files/black.jpg?v=2"],
      hasUnreadyImage: false,
      isPreorder: false,
    });
    rebuildOrderIssues(parsed.orders[0]);

    expect(line.imageUrl).toBe("");
    expect(line.issues.map((issue) => issue.code)).toContain("MISSING_IMAGE");
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
  });

  it("blocks a multi-item order when any one variant image does not match", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1007",
        "buyer@example.com",
        "Line Item",
        "Car A",
        "https://cdn.shopify.com/s/files/1/a.jpg?v=1",
        "10001",
        949,
        1,
      ],
      [
        "#1007",
        "",
        "Line Item",
        "Car B",
        "https://cdn.shopify.com/s/files/1/b.jpg?v=1",
        "10002",
        1299,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    applyVariantImageVerification(parsed.orders[0].lineItems[0], {
      title: "Car A — Default",
      imageUrls: ["https://cdn.shopify.com/s/files/1/a.jpg?v=2"],
      hasUnreadyImage: false,
      isPreorder: false,
    });
    applyVariantImageVerification(parsed.orders[0].lineItems[1], {
      title: "Car B — Default",
      imageUrls: ["https://cdn.shopify.com/s/files/1/not-b.jpg?v=2"],
      hasUnreadyImage: false,
      isPreorder: false,
    });
    rebuildOrderIssues(parsed.orders[0]);

    expect(parsed.orders[0].lineItems[0].issues).toEqual([]);
    expect(
      parsed.orders[0].lineItems[1].issues.map((issue) => issue.code),
    ).toContain("VARIANT_IMAGE_MISMATCH");
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
  });

  it("distinguishes a missing variant image assignment from a missing variant", async () => {
    const buffer = await workbookBuffer([
      [
        "Name",
        "Customer: Email",
        "Line: Type",
        "Line: Title",
        "Line: Image",
        "Line: Variant ID",
        "Line: Price",
        "Line: Quantity",
      ],
      [
        "#1008",
        "buyer@example.com",
        "Line Item",
        "Car",
        "https://cdn.shopify.com/s/files/1/a.jpg",
        "10001",
        949,
        1,
      ],
    ]);
    const parsed = await parseWorkbook(buffer);
    const line = parsed.orders[0].lineItems[0];

    applyVariantImageVerification(line, {
      title: "Car — Default",
      imageUrls: [],
      hasUnreadyImage: false,
      isPreorder: false,
    });
    expect(line.issues.map((issue) => issue.code)).toContain(
      "VARIANT_IMAGE_NOT_ASSIGNED",
    );

    applyVariantImageVerification(line, undefined);
    expect(line.issues.map((issue) => issue.code)).toContain(
      "VARIANT_NOT_FOUND",
    );
    expect(line.issues.map((issue) => issue.code)).not.toContain(
      "VARIANT_IMAGE_NOT_ASSIGNED",
    );
  });
});
