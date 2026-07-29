export type DestinationField =
  | "command"
  | "orderId"
  | "orderName"
  | "customerEmail"
  | "customerName"
  | "customerPhone"
  | "processedAt"
  | "currency"
  | "financialStatus"
  | "fulfillmentStatus"
  | "billingAddress"
  | "shippingAddress"
  | "productTitle"
  | "variantTitle"
  | "productId"
  | "variantId"
  | "sku"
  | "quantity"
  | "price"
  | "discount"
  | "imageUrl"
  | "productUrl"
  | "notes"
  | "tags";

export type ColumnMapping = Partial<Record<DestinationField, string>>;

export type ValidationIssue = {
  code: string;
  message: string;
  field?: DestinationField;
  row?: number;
  severity: "info" | "warning" | "error";
};

export type ParsedLineItem = {
  sourceRowNumber: number;
  productTitle: string;
  variantTitle?: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  imageUrl?: string;
  productUrl?: string;
  rawRow: Record<string, string>;
  issues: ValidationIssue[];
};

export type ParsedOrder = {
  sourceOrderId: string;
  sourceOrderName?: string;
  deterministicKey: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  processedAt?: Date;
  currency: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  billingAddress?: string;
  shippingAddress?: string;
  note?: string;
  tags: string[];
  lineItems: ParsedLineItem[];
  issues: ValidationIssue[];
};

export type WorkbookParseResult = {
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  totalRows: number;
  mapping: ColumnMapping;
  orders: ParsedOrder[];
};

