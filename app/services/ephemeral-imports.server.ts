import crypto from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
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
    if (job.updatedAt.getTime() < cutoff) {
      jobs.delete(id);
      if (latestByShop.get(job.shop) === id) latestByShop.delete(job.shop);
    }
  }
}

export function clearEphemeralJobsForShop(shop: string) {
  let cleared = 0;
  for (const [id, job] of jobs) {
    if (job.shop !== shop) continue;
    jobs.delete(id);
    cleared += 1;
  }
  latestByShop.delete(shop);
  return cleared;
}

export function createEphemeralJob(
  shop: string,
  fileName: string,
  result: WorkbookParseResult,
) {
  cleanup();
  // The UI exposes one current import per shop. Discard superseded jobs so
  // inaccessible workbook data cannot accumulate for the full 24-hour TTL.
  clearEphemeralJobsForShop(shop);
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

const CUSTOMER_SHIPPING_ISSUE_CODES = new Set([
  "CUSTOMER_EMAIL_REQUIRED_FOR_SHIPPING",
  "SHOPIFY_CUSTOMER_NOT_FOUND",
  "MISSING_CUSTOMER_DEFAULT_SHIPPING_ADDRESS",
  "CUSTOMER_SHIPPING_ADDRESS_LOOKUP_FAILED",
]);

export function applyCustomerShippingAddressValidation(
  orders: ParsedOrder[],
  customerProfiles: Map<string, CustomerVerificationProfile | null>,
) {
  for (const order of orders) {
    order.issues = order.issues.filter(
      (issue) => !CUSTOMER_SHIPPING_ISSUE_CODES.has(issue.code),
    );
    const email = normalizedEmail(order.customerEmail);
    if (!email) {
      order.issues.push({
        code: "CUSTOMER_EMAIL_REQUIRED_FOR_SHIPPING",
        message:
          "Customer email is required to find the Shopify customer's saved shipping address.",
        field: "shippingAddress",
        severity: "error",
      });
      continue;
    }
    if (!customerProfiles.has(email)) {
      order.issues.push({
        code: "CUSTOMER_SHIPPING_ADDRESS_LOOKUP_FAILED",
        message: `Could not verify a saved Shopify customer address for ${email}. Try again before importing.`,
        field: "shippingAddress",
        severity: "error",
      });
      continue;
    }
    const profile = customerProfiles.get(email);
    if (!profile) {
      order.issues.push({
        code: "SHOPIFY_CUSTOMER_NOT_FOUND",
        message: `No Shopify customer was found for ${email}. Create or match the customer and add an address before importing.`,
        field: "shippingAddress",
        severity: "error",
      });
      continue;
    }
    if (!profile.defaultShippingAddress?.address1?.trim()) {
      order.issues.push({
        code: "MISSING_CUSTOMER_DEFAULT_SHIPPING_ADDRESS",
        message: `The Shopify customer ${email} has no usable saved address. Add an address before importing.`,
        field: "shippingAddress",
        severity: "error",
      });
    }
  }
  return orders;
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
  const fetchedForRequest = new Map<
    string,
    CustomerVerificationProfile | null
  >();

  if (uncachedEmails.length) {
    const fetchedProfiles = await findCustomerProfilesByEmail(
      admin,
      uncachedEmails,
    );
    for (const [email, profile] of fetchedProfiles) {
      fetchedForRequest.set(email, profile);
      // Keep successful address lookups fast during navigation. Profiles
      // without an address are rechecked so a newly added address can still
      // enrich an order before it is imported.
      if (profile?.defaultShippingAddress) {
        job.customerProfiles.set(email, profile);
      }
    }
    job.updatedAt = new Date();
  }

  return new Map(
    requestedEmails.flatMap((email) => {
      if (job.customerProfiles.has(email)) {
        return [[email, job.customerProfiles.get(email) ?? null] as const];
      }
      if (fetchedForRequest.has(email)) {
        return [[email, fetchedForRequest.get(email) ?? null] as const];
      }
      return [];
    }),
  );
}

export function clearEphemeralJob(shop: string, id: string) {
  const job = getEphemeralJob(shop, id);
  if (!job) return false;
  jobs.delete(id);
  if (latestByShop.get(shop) === id) latestByShop.delete(shop);
  return true;
}

function normalizedOrderNumber(value: string) {
  return value.trim().replace(/^#/, "").toLowerCase();
}

export function markOrdersUnfulfilled(
  job: EphemeralJob,
  pastedOrderNumbers: string,
) {
  const requested = new Map<string, string>();
  for (const value of pastedOrderNumbers.split(/[\s,;]+/)) {
    const normalized = normalizedOrderNumber(value);
    if (normalized && !requested.has(normalized)) {
      requested.set(normalized, value.trim());
    }
  }

  const matched = new Set<string>();
  for (const order of job.pending) {
    const identifiers = [order.sourceOrderName, order.sourceOrderId]
      .filter((value): value is string => Boolean(value))
      .map(normalizedOrderNumber);
    const requestedIdentifier = identifiers.find((identifier) =>
      requested.has(identifier),
    );
    if (!requestedIdentifier) continue;

    order.fulfillmentStatus = "Unfulfilled";
    order.issues = order.issues.filter(
      (issue) => issue.code !== "INCOMPLETE_FULFILLMENT_STATUS",
    );
    matched.add(requestedIdentifier);
  }

  const notFound = [...requested.entries()]
    .filter(([identifier]) => !matched.has(identifier))
    .map(([, original]) => original);
  if (matched.size) {
    job.status = "PENDING";
    job.currentMessage = `${matched.size} order${
      matched.size === 1 ? "" : "s"
    } marked Unfulfilled and ready for import`;
    job.updatedAt = new Date();
  }

  return {
    requested: requested.size,
    marked: matched.size,
    notFound,
  };
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

  const customerProfiles = await getCachedCustomerProfiles(
    job,
    admin,
    verifiedCandidates.map((order) => order.customerEmail),
  );
  applyCustomerShippingAddressValidation(verifiedCandidates, customerProfiles);
  const addressVerifiedCandidates = verifiedCandidates.filter(
    (order) => !hasBlockingIssues(order),
  );
  const newlyAddressBlocked =
    verifiedCandidates.length - addressVerifiedCandidates.length;
  if (!addressVerifiedCandidates.length) {
    job.status = "PENDING";
    job.currentMessage = `${newlyAddressBlocked} selected order${
      newlyAddressBlocked === 1 ? " is" : "s are"
    } blocked because a saved Shopify customer address is required.`;
    job.updatedAt = new Date();
    return 0;
  }
  let importedThisRun = 0;
  for (const order of addressVerifiedCandidates) {
    try {
      const customerProfile = order.customerEmail
        ? customerProfiles.get(order.customerEmail.trim().toLowerCase())
        : null;
      await createHistoricalOrder(admin, {
        ...order,
        name: order.sourceOrderName ?? order.sourceOrderId,
        customerId: customerProfile?.id,
        shippingAddress: customerProfile?.defaultShippingAddress,
        shippingCharge: order.shippingCharge,
        lineItems: order.lineItems.map((line) => ({
          title: line.productTitle,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          properties: [
            ...(line.isPreorder ? [{ name: "_preorder", value: "true" }] : []),
            ...(line.preorderEta
              ? [
                  { name: "_preorder_eta", value: line.preorderEta },
                  { name: "_preorder_eta_source", value: "product metafield" },
                ]
              : []),
            ...(line.preorderPendingPrice
              ? [
                  {
                    name: "_preorder_pending_price",
                    value: line.preorderPendingPrice,
                  },
                ]
              : []),
          ],
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
        newlyBlocked || newlyAddressBlocked
          ? ` (${newlyBlocked + newlyAddressBlocked} newly blocked by current Shopify verification)`
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
    "Fulfillment Status",
    "Shipping Charge",
    "Product",
    "Variant ID",
    "SKU",
    "Quantity",
    "Price",
    "Reason",
  ];
  const rows = job.pending.filter(hasBlockingIssues).flatMap((order) =>
    order.lineItems.map((line) => [
      order.sourceOrderName ?? order.sourceOrderId,
      order.customerEmail ?? "",
      order.processedAt?.toISOString() ?? "",
      order.fulfillmentStatus ?? "Fulfilled",
      order.shippingCharge,
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
  const { default: ExcelJS } = await import("exceljs");
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
    {
      header: "Fulfillment Status",
      key: "fulfillmentStatus",
      width: 22,
    },
    { header: "Shipping Charge", key: "shippingCharge", width: 18 },
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

  for (const order of job.pending.filter(hasBlockingIssues)) {
    for (const line of order.lineItems) {
      sheet.addRow({
        source: order.sourceOrderName ?? order.sourceOrderId,
        customer: order.customerName ?? "",
        email: order.customerEmail ?? "",
        processedAt: order.processedAt?.toISOString() ?? "",
        fulfillmentStatus: order.fulfillmentStatus ?? "Fulfilled",
        shippingCharge: order.shippingCharge,
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
  sheet.getColumn("shippingCharge").numFmt = "₹#,##0.00";
  sheet.autoFilter = { from: "A1", to: "N1" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
