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
import {
  isCompletedFulfillmentStatus,
  normalizeFulfillmentStatus,
} from "../lib/fulfillment-status";
import { detectMapping, KDC_MAPPING } from "./mapping.server";
import {
  createWorkbookParsingBuffer,
  MAX_WORKBOOK_ROWS,
  WorkbookResourceLimitError,
} from "./workbook-limits.server";

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

const VARIANT_IMAGE_ISSUE_CODES = new Set([
  "VARIANT_NOT_FOUND",
  "VARIANT_IMAGE_NOT_ASSIGNED",
  "VARIANT_IMAGE_NOT_READY",
  "VARIANT_IMAGE_MISMATCH",
]);

export function canonicalShopifyCdnImageUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const valid =
      url.protocol === "https:" &&
      url.hostname === "cdn.shopify.com" &&
      url.pathname.startsWith("/s/files/");
    return valid ? `https://cdn.shopify.com${url.pathname}` : null;
  } catch {
    return null;
  }
}

function isShopifyCdnImageUrl(value?: string) {
  return canonicalShopifyCdnImageUrl(value) !== null;
}

export function shopifyVariantImageUrlsMatch(
  workbookImageUrl?: string,
  variantImageUrl?: string,
) {
  const workbookImage = canonicalShopifyCdnImageUrl(workbookImageUrl);
  const variantImage = canonicalShopifyCdnImageUrl(variantImageUrl);
  return Boolean(
    workbookImage && variantImage && workbookImage === variantImage,
  );
}

export function applyVariantImageVerification(
  line: ParsedLineItem,
  verified?: {
    title: string;
    imageUrls: string[];
    hasUnreadyImage: boolean;
  },
) {
  line.issues = line.issues.filter(
    (issue) => !VARIANT_IMAGE_ISSUE_CODES.has(issue.code),
  );
  const numericId = line.variantId?.replace(
    "gid://shopify/ProductVariant/",
    "",
  );
  if (!numericId || !variantIdSchema.safeParse(numericId).success) return line;

  if (!verified) {
    line.issues.push({
      code: "VARIANT_NOT_FOUND",
      message: `Shopify variant ${numericId} does not exist.`,
      field: "variantId",
      row: line.sourceRowNumber,
      severity: "error",
    });
    return line;
  }

  line.variantId = `gid://shopify/ProductVariant/${numericId}`;
  line.productTitle = verified.title;
  if (!verified.imageUrls.length) {
    line.issues.push({
      code: verified.hasUnreadyImage
        ? "VARIANT_IMAGE_NOT_READY"
        : "VARIANT_IMAGE_NOT_ASSIGNED",
      message: verified.hasUnreadyImage
        ? "The image assigned to this Shopify variant is still processing and cannot be verified."
        : "This Shopify variant has no assigned image. Assign an image to the exact variant before importing.",
      field: "imageUrl",
      row: line.sourceRowNumber,
      severity: "error",
    });
    return line;
  }

  const workbookImage = canonicalShopifyCdnImageUrl(line.imageUrl);
  if (!workbookImage) return line;
  const matchesAssignedImage = verified.imageUrls.some((imageUrl) =>
    shopifyVariantImageUrlsMatch(line.imageUrl, imageUrl),
  );
  if (!matchesAssignedImage) {
    line.issues.push({
      code: "VARIANT_IMAGE_MISMATCH",
      message: `The Excel image does not match an image assigned to Shopify variant ${numericId}. Check the variant ID and Line: Image URL.`,
      field: "imageUrl",
      row: line.sourceRowNumber,
      severity: "error",
    });
  }
  return line;
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

function firstAliasedValue(
  rows: Record<string, string>[],
  candidates: string[],
) {
  const available = Object.keys(rows[0] ?? {});
  const header = available.find((item) =>
    candidates.some(
      (candidate) =>
        item
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim() ===
        candidate
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim(),
    ),
  );
  return firstValue(rows, header);
}

function composedAddress(
  rows: Record<string, string>[],
  prefix: "Shipping" | "Billing",
) {
  const values = [
    firstAliasedValue(rows, [`${prefix}: Name`, `${prefix} Name`]),
    firstAliasedValue(rows, [`${prefix}: Company`, `${prefix} Company`]),
    firstAliasedValue(rows, [
      `${prefix}: Address 1`,
      `${prefix} Address 1`,
      `${prefix}: Address1`,
    ]),
    firstAliasedValue(rows, [
      `${prefix}: Address 2`,
      `${prefix} Address 2`,
      `${prefix}: Address2`,
    ]),
    firstAliasedValue(rows, [`${prefix}: City`, `${prefix} City`]),
    firstAliasedValue(rows, [
      `${prefix}: Province`,
      `${prefix} Province`,
      `${prefix}: Province Code`,
    ]),
    firstAliasedValue(rows, [
      `${prefix}: Zip`,
      `${prefix} Zip`,
      `${prefix}: Postal Code`,
    ]),
    firstAliasedValue(rows, [
      `${prefix}: Country`,
      `${prefix} Country`,
      `${prefix}: Country Code`,
    ]),
  ].filter((value): value is string => Boolean(value));
  return values.length ? [...new Set(values)].join(", ") : undefined;
}

export async function parseWorkbook(
  buffer: Buffer,
  options?: { sheetName?: string; mapping?: ColumnMapping },
): Promise<WorkbookParseResult> {
  const parsingBuffer = await createWorkbookParsingBuffer(buffer);
  const sheetNames = await readSheetNames(parsingBuffer);
  const rows = await readXlsxFile(parsingBuffer, {
    ...(options?.sheetName ? { sheet: options.sheetName } : {}),
  });
  if (!rows.length) throw new Error("The workbook has no readable rows.");
  if (rows.length - 1 > MAX_WORKBOOK_ROWS) {
    throw new WorkbookResourceLimitError(
      `The selected sheet contains more than ${MAX_WORKBOOK_ROWS.toLocaleString("en-IN")} data rows. Split it into smaller workbooks before importing.`,
    );
  }

  const headers = rows[0].map(cellText).filter(Boolean);
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
    if (Object.values(values).some(Boolean))
      rawRows.push({ rowNumber, values });
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
          message:
            "Customer email is missing. Confirm or add a customer before import.",
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
          const imageUrl = mapping.imageUrl
            ? values[mapping.imageUrl]
            : undefined;
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
            productId: mapping.productId
              ? values[mapping.productId]
              : undefined,
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
      const fulfillmentStatuses = mapping.fulfillmentStatus
        ? rows
            .map((row) => row[mapping.fulfillmentStatus!])
            .filter(Boolean)
            .map(normalizeFulfillmentStatus)
        : [];
      const incompleteFulfillmentStatus = fulfillmentStatuses.find(
        (status) => !isCompletedFulfillmentStatus(status),
      );
      const fulfillmentStatus = incompleteFulfillmentStatus ?? "Fulfilled";
      if (incompleteFulfillmentStatus) {
        issues.push({
          code: "INCOMPLETE_FULFILLMENT_STATUS",
          message: `Fulfillment Status is "${incompleteFulfillmentStatus}". Only completed (Fulfilled) orders can be imported.`,
          field: "fulfillmentStatus",
          severity: "error",
        });
      }
      const shippingChargeRaw = firstValue(rows, mapping.shippingCharge);
      const shippingChargeResult = moneySchema.safeParse(
        (shippingChargeRaw || "0").replace(/[₹,\s]/g, ""),
      );
      if (!shippingChargeResult.success) {
        issues.push({
          code: "INVALID_SHIPPING_CHARGE",
          message: "Shipping Charge must be zero or a positive number.",
          field: "shippingCharge",
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
        customerName:
          firstValue(rows, mapping.customerName) ??
          firstAliasedValue(rows, [
            "Customer: Name",
            "Customer Name",
            "Shipping: Name",
            "Billing: Name",
          ]),
        customerPhone:
          firstValue(rows, mapping.customerPhone) ??
          firstAliasedValue(rows, [
            "Customer: Phone",
            "Customer Phone",
            "Shipping: Phone",
            "Billing: Phone",
          ]),
        processedAt: parseDate(processedRaw),
        currency: firstValue(rows, mapping.currency) || "INR",
        financialStatus: firstValue(rows, mapping.financialStatus),
        fulfillmentStatus,
        billingAddress:
          firstValue(rows, mapping.billingAddress) ??
          composedAddress(rows, "Billing"),
        shippingAddress:
          firstValue(rows, mapping.shippingAddress) ??
          composedAddress(rows, "Shipping"),
        shippingCharge: shippingChargeResult.success
          ? shippingChargeResult.data
          : 0,
        note: firstValue(rows, mapping.notes),
        tags: ["Order Import"],
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
          "VARIANT_IMAGE_NOT_ASSIGNED",
          "VARIANT_IMAGE_NOT_READY",
          "VARIANT_IMAGE_MISMATCH",
        ].includes(issue.code),
    ),
    ...order.lineItems.flatMap((item) => item.issues),
  ];
  return order;
}
