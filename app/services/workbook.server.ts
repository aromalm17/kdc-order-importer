import crypto from "node:crypto";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { z } from "zod";
import type {
  ColumnMapping,
  ParsedLineItem,
  ParsedOrder,
  ValidationIssue,
  WorkbookParseResult,
} from "../lib/import-types";
import { detectMapping, KDC_MAPPING } from "./mapping.server";

const quantitySchema = z.coerce.number().int().positive();
const moneySchema = z.coerce.number().finite().nonnegative();
const variantIdSchema = z
  .string()
  .regex(/^(gid:\/\/shopify\/ProductVariant\/)?\d+$/);

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function isShopifyCdnImageUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "cdn.shopify.com" &&
      url.pathname.startsWith("/s/files/")
    );
  } catch {
    return false;
  }
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function deterministicKey(parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function firstValue(rows: Record<string, string>[], header?: string) {
  if (!header) return undefined;
  return rows.map((row) => row[header]).find(Boolean);
}

export async function parseWorkbook(
  buffer: Buffer,
  options?: { sheetName?: string; mapping?: ColumnMapping },
): Promise<WorkbookParseResult> {
  const sheetNames = await readSheetNames(buffer);
  const rows = await readXlsxFile(buffer, {
    ...(options?.sheetName ? { sheet: options.sheetName } : {}),
  });
  if (!rows.length) throw new Error("The workbook has no readable rows.");

  const headers = rows[0]
    .map(cellText)
    .filter(Boolean);
  const mapping = {
    ...detectMapping(headers),
    ...(headers.includes("Customer: Email") ? KDC_MAPPING : {}),
    ...options?.mapping,
  };
  const rawRows: { rowNumber: number; values: Record<string, string> }[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      values[header] = cellText(row[index]);
    });
    if (Object.values(values).some(Boolean)) rawRows.push({ rowNumber, values });
  });

  const grouped = new Map<string, typeof rawRows>();
  for (const row of rawRows) {
    const explicit =
      (mapping.orderId && row.values[mapping.orderId]) ||
      (mapping.orderName && row.values[mapping.orderName]);
    const generated =
      explicit ||
      deterministicKey([
        mapping.customerEmail ? row.values[mapping.customerEmail] : "",
        mapping.processedAt ? row.values[mapping.processedAt] : "",
        String(row.rowNumber),
      ]);
    grouped.set(generated, [...(grouped.get(generated) ?? []), row]);
  }

  const orders: ParsedOrder[] = [...grouped.entries()].map(
    ([groupingValue, groupedRows]) => {
      const rows = groupedRows.map((row) => row.values);
      const issues: ValidationIssue[] = [];
      const sourceOrderName = firstValue(rows, mapping.orderName);
      const sourceOrderId =
        firstValue(rows, mapping.orderId) ?? sourceOrderName ?? groupingValue;
      const email = firstValue(rows, mapping.customerEmail);
      if (!email) {
        issues.push({
          code: "MISSING_CUSTOMER_EMAIL",
          message: "Customer email is missing. Confirm or add a customer before import.",
          field: "customerEmail",
          severity: "error",
        });
      } else if (!z.string().email().safeParse(email).success) {
        issues.push({
          code: "INVALID_CUSTOMER_EMAIL",
          message: `Customer email "${email}" is invalid.`,
          field: "customerEmail",
          severity: "error",
        });
      }

      const lineItems: ParsedLineItem[] = groupedRows
        .filter(({ values }) => {
          const type = values["Line: Type"]?.toLowerCase();
          return !type || type === "line item";
        })
        .map(({ rowNumber, values }) => {
          const lineIssues: ValidationIssue[] = [];
          const productTitle = mapping.productTitle
            ? values[mapping.productTitle]
            : "";
          const quantityRaw = mapping.quantity ? values[mapping.quantity] : "";
          const priceRaw = mapping.price ? values[mapping.price] : "";
          const variantId = mapping.variantId
            ? values[mapping.variantId]
            : undefined;
          const imageUrl = mapping.imageUrl ? values[mapping.imageUrl] : undefined;
          const quantityResult = quantitySchema.safeParse(quantityRaw);
          const priceResult = moneySchema.safeParse(
            priceRaw.replace(/[₹,\s]/g, ""),
          );

          if (!productTitle) {
            lineIssues.push({
              code: "MISSING_PRODUCT_TITLE",
              message: "Product title is required.",
              field: "productTitle",
              row: rowNumber,
              severity: "error",
            });
          }
          if (!variantId) {
            lineIssues.push({
              code: "MISSING_VARIANT_ID",
              message: "A verified Shopify variant must be mapped.",
              field: "variantId",
              row: rowNumber,
              severity: "error",
            });
          } else if (!variantIdSchema.safeParse(variantId).success) {
            lineIssues.push({
              code: "INVALID_VARIANT_ID",
              message: `Variant ID "${variantId}" is not a Shopify variant ID.`,
              field: "variantId",
              row: rowNumber,
              severity: "error",
            });
          }
          if (!quantityResult.success) {
            lineIssues.push({
              code: "INVALID_QUANTITY",
              message: "Quantity must be a positive whole number.",
              field: "quantity",
              row: rowNumber,
              severity: "error",
            });
          }
          if (!priceResult.success) {
            lineIssues.push({
              code: "INVALID_PRICE",
              message: "Price must be zero or a positive number.",
              field: "price",
              row: rowNumber,
              severity: "error",
            });
          }
          if (!imageUrl) {
            lineIssues.push({
              code: "MISSING_IMAGE",
              message: "A verified product image is required.",
              field: "imageUrl",
              row: rowNumber,
              severity: "error",
            });
          } else if (!isShopifyCdnImageUrl(imageUrl)) {
            lineIssues.push({
              code: "INVALID_IMAGE_URL",
              message:
                'The image URL must start with "https://cdn.shopify.com/s/files/".',
              field: "imageUrl",
              row: rowNumber,
              severity: "error",
            });
          }
          return {
            sourceRowNumber: rowNumber,
            productTitle,
            variantTitle: mapping.variantTitle
              ? values[mapping.variantTitle]
              : undefined,
            productId: mapping.productId ? values[mapping.productId] : undefined,
            variantId,
            sku: mapping.sku ? values[mapping.sku] : undefined,
            quantity: quantityResult.success ? quantityResult.data : 0,
            unitPrice: priceResult.success ? priceResult.data : 0,
            discountAmount: mapping.discount
              ? Number(values[mapping.discount] || 0)
              : undefined,
            imageUrl,
            productUrl: mapping.productUrl
              ? values[mapping.productUrl]
              : undefined,
            rawRow: values,
            issues: lineIssues,
          };
        });

      if (!lineItems.length) {
        issues.push({
          code: "NO_LINE_ITEMS",
          message: "The order contains no product line items.",
          severity: "error",
        });
      }
      issues.push(...lineItems.flatMap((item) => item.issues));

      const processedRaw = firstValue(rows, mapping.processedAt);
      if (processedRaw && !parseDate(processedRaw)) {
        issues.push({
          code: "INVALID_PROCESSED_DATE",
          message: `Processed date "${processedRaw}" is invalid.`,
          field: "processedAt",
          severity: "error",
        });
      }

      return {
        sourceOrderId,
        sourceOrderName,
        deterministicKey: deterministicKey([
          sourceOrderId,
          firstValue(rows, mapping.processedAt) ?? "",
          ...lineItems.map(
            (line) =>
              `${line.variantId ?? line.sku ?? line.productTitle}:${line.quantity}`,
          ),
        ]),
        customerEmail: email,
        customerName: firstValue(rows, mapping.customerName),
        customerPhone: firstValue(rows, mapping.customerPhone),
        processedAt: parseDate(processedRaw),
        currency: firstValue(rows, mapping.currency) || "INR",
        financialStatus: firstValue(rows, mapping.financialStatus),
        fulfillmentStatus: firstValue(rows, mapping.fulfillmentStatus),
        billingAddress: firstValue(rows, mapping.billingAddress),
        shippingAddress: firstValue(rows, mapping.shippingAddress),
        note: firstValue(rows, mapping.notes),
        tags: [
          "KDC-Historical-Import",
          "KDC Order History Import",
          ...(firstValue(rows, mapping.tags)?.split(",").map((tag) => tag.trim()) ??
            []),
        ].filter(Boolean),
        lineItems,
        issues,
      };
    },
  );

  return {
    sheetNames,
    selectedSheet: options?.sheetName ?? sheetNames[0],
    headers,
    totalRows: rawRows.length,
    mapping,
    orders,
  };
}

export function hasBlockingIssues(order: ParsedOrder) {
  return order.issues.some((issue) => issue.severity === "error");
}

export function rebuildOrderIssues(order: ParsedOrder) {
  order.issues = [
    ...order.issues.filter(
      (issue) =>
        issue.row === undefined &&
        ![
          "MISSING_VARIANT_ID",
          "INVALID_VARIANT_ID",
          "MISSING_IMAGE",
          "INVALID_IMAGE_URL",
          "VARIANT_NOT_FOUND",
        ].includes(issue.code),
    ),
    ...order.lineItems.flatMap((item) => item.issues),
  ];
  return order;
}
