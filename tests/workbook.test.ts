import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { hasBlockingIssues, parseWorkbook } from "../app/services/workbook.server";

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("workbook parser", () => {
  it("groups multiple rows into one order and keeps all line items", async () => {
    const buffer = await workbookBuffer([
      ["Command", "Name", "Customer: Email", "Payment: Status", "Line: Type", "Line: Title", "Line: Image", "Line: Variant ID", "Line: Price", "Line: Quantity", "Processed At", "Currency"],
      ["NEW", "#1001", "buyer@example.com", "Paid", "Line Item", "Car A", "https://cdn.shopify.com/s/files/1/a.jpg", "10001", 949, 1, "2026-07-01 10:00", "INR"],
      ["NEW", "#1001", "", "", "Line Item", "Car B", "https://cdn.shopify.com/s/files/1/b.jpg", "10002", 1299, 2, "2026-07-01 10:00", ""],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].lineItems).toHaveLength(2);
    expect(parsed.orders[0].customerEmail).toBe("buyer@example.com");
    expect(hasBlockingIssues(parsed.orders[0])).toBe(false);
  });

  it("blocks the entire order when a line lacks variant or public image", async () => {
    const buffer = await workbookBuffer([
      ["Name", "Customer: Email", "Line: Type", "Line: Title", "Line: Image", "Line: Variant ID", "Line: Price", "Line: Quantity"],
      ["#1002", "buyer@example.com", "Line Item", "Car A", "https://admin.shopify.com/store/kdc/products/1", "", 949, 1],
    ]);
    const parsed = await parseWorkbook(buffer);
    expect(hasBlockingIssues(parsed.orders[0])).toBe(true);
    expect(parsed.orders[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MISSING_VARIANT_ID", "INVALID_IMAGE_URL"]),
    );
  });

  it("generates stable order keys from source identity and lines", async () => {
    const rows = [
      ["Name", "Customer: Email", "Line: Type", "Line: Title", "Line: Image", "Line: Variant ID", "Line: Price", "Line: Quantity"],
      ["#1003", "buyer@example.com", "Line Item", "Car", "https://cdn.shopify.com/s/files/1/a.jpg", "10001", 949, 1],
    ];
    const first = await parseWorkbook(await workbookBuffer(rows));
    const second = await parseWorkbook(await workbookBuffer(rows));
    expect(first.orders[0].deterministicKey).toBe(second.orders[0].deterministicKey);
  });

  it("rejects image URLs outside the Shopify files CDN path", async () => {
    const buffer = await workbookBuffer([
      ["Name", "Customer: Email", "Line: Type", "Line: Title", "Line: Image", "Line: Variant ID", "Line: Price", "Line: Quantity"],
      ["#1004", "buyer@example.com", "Line Item", "Car", "https://cdn.example.com/a.jpg", "10001", 949, 1],
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
});
