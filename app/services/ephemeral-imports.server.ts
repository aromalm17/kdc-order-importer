import crypto from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ParsedOrder, WorkbookParseResult } from "../lib/import-types";
import { hasBlockingIssues } from "./workbook.server";
import { createHistoricalOrder } from "./shopify-orders.server";

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

export async function importReadyOrders(
  job: EphemeralJob,
  admin: AdminApiContext,
) {
  if (job.status === "RUNNING") return;
  job.status = "RUNNING";
  job.currentMessage = "Importing ready orders";
  job.updatedAt = new Date();

  const candidates = job.pending.filter((order) => !hasBlockingIssues(order));
  for (const order of candidates) {
    try {
      await createHistoricalOrder(admin, {
        ...order,
        lineItems: order.lineItems.map((line) => ({
          variantId: line.variantId ?? null,
          quantity: line.quantity,
        })),
      });
      job.pending = job.pending.filter(
        (candidate) => candidate.deterministicKey !== order.deterministicKey,
      );
      job.importedOrders += 1;
      job.currentMessage = `Imported ${job.importedOrders}; ${job.pending.length} pending`;
    } catch (error) {
      order.issues = [
        ...order.issues.filter((issue) => issue.code !== "SHOPIFY_IMPORT_ERROR"),
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
    ? `${job.pending.length} orders remain pending`
    : "All ready orders imported successfully";
  job.updatedAt = new Date();
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
