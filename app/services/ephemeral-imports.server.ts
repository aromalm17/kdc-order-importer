import crypto from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import ExcelJS from "exceljs";
import type { ParsedOrder, WorkbookParseResult } from "../lib/import-types";
import { hasBlockingIssues } from "./workbook.server";
import {
  createHistoricalOrder,
  findCustomerProfilesByEmail,
  type CustomerVerificationProfile,
} from "./shopify-orders.server";
import { verifyOrderVariantImages } from "./variant-verification.server";

export type EphemeralJob = {
  id: string;
  shop: string;
  fileName: string;
  createdAt: Date;
  updatedAt: Date;
  totalOrders: number;
  importedOrders: number;
  status: "PREVIEW" | "RUNNING" | "PENDING" | "COMPLETED";
  currentMessage: string;
  pending: ParsedOrder[];
  customerProfiles: Map<string, CustomerVerificationProfile | null>;
};

const jobs = new Map<string, EphemeralJob>();
const latestByShop = new Map<string, string>();
const TTL_MS = 24 * 60 * 60 * 1000;

function cleanup() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt.getTime() < cutoff) jobs.delete(id);
  }
}

export function createEphemeralJob(
  shop: string,
  fileName: string,
  result: WorkbookParseResult,
) {
  cleanup();
  const id = crypto.randomUUID();
  const job: EphemeralJob = {
    id,
    shop,
    fileName,
    createdAt: new Date(),
    updatedAt: new Date(),
    totalOrders: result.orders.length,
    importedOrders: 0,
    status: "PREVIEW",
    currentMessage: "Ready for review",
    pending: result.orders,
    customerProfiles: new Map(),
  };
  jobs.set(id, job);
  latestByShop.set(shop, id);
  return job;
}

export function getEphemeralJob(shop: string, id?: string | null) {
  cleanup();
  const job = jobs.get(id || latestByShop.get(shop) || "");
  return job?.shop === shop ? job : undefined;
}

function normalizedEmail(email?: string) {
  return email?.trim().toLowerCase() || null;
}

export async function getCachedCustomerProfiles(
  job: EphemeralJob,
  admin: AdminApiContext,
  emails: Array<string | undefined>,
) {
  const requestedEmails = [
    ...new Set(
      emails
        .map(normalizedEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const uncachedEmails = requestedEmails.filter(
    (email) => !job.customerProfiles.has(email),
  );

  if (uncachedEmails.length) {
    const fetchedProfiles = await findCustomerProfilesByEmail(
      admin,
      uncachedEmails,
    );
    for (const [email, profile] of fetchedProfiles) {
      job.customerProfiles.set(email, profile);
    }
    job.updatedAt = new Date();
  }

  return new Map(
    requestedEmails
      .filter((email) => job.customerProfiles.has(email))
      .map((email) => [email, job.customerProfiles.get(email) ?? null]),
  );
}

export function clearEphemeralJob(shop: string, id: string) {
  const job = getEphemeralJob(shop, id);
  if (!job) return false;
  jobs.delete(id);
  if (latestByShop.get(shop) === id) latestByShop.delete(shop);
  return true;
}

export function shopSummary(shop: string) {
  const job = getEphemeralJob(shop);
  return {
    job,
    pending: job?.pending.length ?? 0,
    imported: job?.importedOrders ?? 0,
    blocked: job?.pending.filter(hasBlockingIssues).length ?? 0,
  };
}

export function getSelectedReadyOrders(
  job: EphemeralJob,
  selectedOrderKeys: readonly string[],
) {
  const selected = new Set(
    selectedOrderKeys.map((key) => key.trim()).filter(Boolean),
  );
  if (!selected.size) return [];
  return job.pending.filter(
    (order) =>
      selected.has(order.deterministicKey) && !hasBlockingIssues(order),
  );
}

export async function importReadyOrders(
  job: EphemeralJob,
  admin: AdminApiContext,
  selectedOrderKeys: readonly string[],
) {
  if (job.status === "RUNNING") return 0;
  const candidates = getSelectedReadyOrders(job, selectedOrderKeys);
  if (!candidates.length) {
    job.currentMessage = "No selected ready orders to import";
    job.updatedAt = new Date();
    return 0;
  }

  job.status = "RUNNING";
  job.currentMessage = `Importing ${candidates.length} selected order${
    candidates.length === 1 ? "" : "s"
  }`;
  job.updatedAt = new Date();

  try {
    await verifyOrderVariantImages(admin, candidates);
  } catch (error) {
    job.status = "PENDING";
    job.currentMessage =
      error instanceof Error
        ? `Variant verification failed: ${error.message}`
        : "Variant verification failed. Try again.";
    job.updatedAt = new Date();
    return 0;
  }
  const verifiedCandidates = candidates.filter(
    (order) => !hasBlockingIssues(order),
  );
  const newlyBlocked = candidates.length - verifiedCandidates.length;
  if (!verifiedCandidates.length) {
    job.status = "PENDING";
    job.currentMessage = `${newlyBlocked} selected order${
      newlyBlocked === 1 ? " was" : "s were"
    } blocked because the current Shopify variant image no longer matches.`;
    job.updatedAt = new Date();
    return 0;
  }

  let importedThisRun = 0;
  for (const order of verifiedCandidates) {
    try {
      await createHistoricalOrder(admin, {
        ...order,
        lineItems: order.lineItems.map((line) => ({
          variantId: line.variantId ?? null,
          quantity: line.quantity,
        })),
      });
      job.pending = job.pending.filter((candidate) => candidate !== order);
      job.importedOrders += 1;
      importedThisRun += 1;
      job.currentMessage = `Imported ${job.importedOrders}; ${job.pending.length} pending`;
    } catch (error) {
      order.issues = [
        ...order.issues.filter(
          (issue) => issue.code !== "SHOPIFY_IMPORT_ERROR",
        ),
        {
          code: "SHOPIFY_IMPORT_ERROR",
          message:
            error instanceof Error ? error.message : "Shopify import failed.",
          severity: "error",
        },
      ];
    }
    job.updatedAt = new Date();
  }

  job.status = job.pending.length ? "PENDING" : "COMPLETED";
  job.currentMessage = job.pending.length
    ? `Imported ${importedThisRun} selected order${
        importedThisRun === 1 ? "" : "s"
      }; ${job.pending.length} remain pending${
        newlyBlocked
          ? ` (${newlyBlocked} blocked by current variant-image verification)`
          : ""
      }`
    : "All selected orders imported successfully";
  job.updatedAt = new Date();
  return importedThisRun;
}

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function pendingCsv(job: EphemeralJob) {
  const headers = [
    "Source order",
    "Customer email",
    "Processed at",
    "Product",
    "Variant ID",
    "SKU",
    "Quantity",
    "Price",
    "Reason",
  ];
  const rows = job.pending.flatMap((order) =>
    order.lineItems.map((line) => [
      order.sourceOrderName ?? order.sourceOrderId,
      order.customerEmail ?? "",
      order.processedAt?.toISOString() ?? "",
      line.productTitle,
      line.variantId ?? "",
      line.sku ?? "",
      line.quantity,
      line.unitPrice,
      [...order.issues, ...line.issues]
        .map((issue) => issue.message)
        .filter(Boolean)
        .join(" | "),
    ]),
  );
  return [headers, ...rows].map((row) => row.map(csv).join(",")).join("\n");
}

export async function pendingWorkbook(job: EphemeralJob) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KDC Order Import";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Pending orders", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Source order", key: "source", width: 18 },
    { header: "Customer", key: "customer", width: 24 },
    { header: "Customer email", key: "email", width: 34 },
    { header: "Processed at", key: "processedAt", width: 23 },
    { header: "Product", key: "product", width: 34 },
    { header: "Variant", key: "variant", width: 22 },
    { header: "Variant ID", key: "variantId", width: 24 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Price", key: "price", width: 14 },
    { header: "Image URL", key: "imageUrl", width: 58 },
    { header: "Reason", key: "reason", width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFECECEC" },
  };

  for (const order of job.pending) {
    for (const line of order.lineItems) {
      sheet.addRow({
        source: order.sourceOrderName ?? order.sourceOrderId,
        customer: order.customerName ?? "",
        email: order.customerEmail ?? "",
        processedAt: order.processedAt?.toISOString() ?? "",
        product: line.productTitle,
        variant: line.variantTitle ?? "",
        variantId: line.variantId ?? "",
        sku: line.sku ?? "",
        quantity: line.quantity,
        price: line.unitPrice,
        imageUrl: line.imageUrl ?? "",
        reason: [...order.issues, ...line.issues]
          .map((issue) => issue.message)
          .filter(Boolean)
          .join(" | "),
      });
    }
  }
  sheet.getColumn("price").numFmt = "₹#,##0.00";
  sheet.autoFilter = { from: "A1", to: "L1" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
