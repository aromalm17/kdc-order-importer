import type { ColumnMapping, DestinationField } from "../lib/import-types";

export const KDC_MAPPING: ColumnMapping = {
  command: "Command",
  orderName: "Name",
  customerEmail: "Customer: Email",
  financialStatus: "Payment: Status",
  productTitle: "Line: Title",
  sku: "Line: SKU",
  imageUrl: "Line: Image",
  variantId: "Line: Variant ID",
  price: "Line: Price",
  quantity: "Line: Quantity",
  processedAt: "Processed At",
  currency: "Currency",
};

export const MATRIXIFY_MAPPING: ColumnMapping = {
  command: "Command",
  orderName: "Name",
  customerEmail: "Email",
  customerPhone: "Phone",
  processedAt: "Processed At",
  currency: "Currency",
  financialStatus: "Financial Status",
  fulfillmentStatus: "Fulfillment Status",
  productTitle: "Line: Title",
  variantTitle: "Line: Variant Title",
  variantId: "Line: Variant ID",
  sku: "Line: SKU",
  quantity: "Line: Quantity",
  price: "Line: Price",
  imageUrl: "Line: Image",
};

const aliases: Record<DestinationField, string[]> = {
  command: ["command"],
  orderId: ["source order id", "order id"],
  orderName: ["name", "order name", "order number", "order no"],
  customerEmail: ["customer email", "email", "contact email"],
  customerName: ["customer name", "name"],
  customerPhone: ["customer phone", "phone", "shipping phone", "billing phone"],
  processedAt: ["processed at", "created at", "order date", "date"],
  currency: ["currency"],
  financialStatus: ["payment status", "financial status"],
  fulfillmentStatus: ["fulfillment status", "fulfilment status"],
  billingAddress: ["billing address"],
  shippingAddress: ["shipping address"],
  productTitle: ["line title", "lineitem title", "product title"],
  variantTitle: ["line variant title", "variant title"],
  productId: ["line product id", "product id"],
  variantId: ["line variant id", "variant id"],
  sku: ["line sku", "lineitem sku", "sku"],
  quantity: ["line quantity", "lineitem quantity", "quantity", "qty"],
  price: ["line price", "lineitem price", "price", "unit price"],
  discount: ["line discount", "discount"],
  imageUrl: ["line image", "image url", "product image"],
  productUrl: ["product url"],
  notes: ["notes", "note"],
  tags: ["tags", "tag"],
};

const canonical = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function detectMapping(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {};
  const canonicalHeaders = headers.map(canonical);
  for (const [field, candidates] of Object.entries(aliases) as [
    DestinationField,
    string[],
  ][]) {
    for (const candidate of candidates) {
      const index = canonicalHeaders.indexOf(canonical(candidate));
      if (index >= 0) {
        result[field] = headers[index];
        break;
      }
    }
  }
  return result;
}

export const REQUIRED_DESTINATIONS: DestinationField[] = [
  "orderName",
  "productTitle",
  "quantity",
  "price",
];

