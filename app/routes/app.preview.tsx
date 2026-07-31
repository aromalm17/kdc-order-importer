import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import {
  clearEphemeralJob,
  getSelectedReadyOrders,
  getCachedCustomerProfiles,
  getEphemeralJob,
  importReadyOrders,
  markOrdersUnfulfilled,
} from "../services/ephemeral-imports.server";
import { hasBlockingIssues } from "../services/workbook.server";
import {
  getAttachmentFilename,
  isExcelResponse,
  XLSX_CONTENT_TYPE,
} from "../utils/download";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("job");
  const job = getEphemeralJob(session.shop, id);
  if (!job) return { job: null, orders: [] };
  const customerProfiles = await getCachedCustomerProfiles(
    job,
    admin,
    job.pending.map((order) => order.customerEmail),
  );
  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      totalOrders: job.totalOrders,
      importedOrders: job.importedOrders,
      status: job.status,
      currentMessage: job.currentMessage,
      readyOrders: job.pending.filter((order) => !hasBlockingIssues(order))
        .length,
      imageValidationErrorOrders: job.pending.filter((order) =>
        order.lineItems.some((line) =>
          line.issues.some((issue) =>
            [
              "MISSING_IMAGE",
              "INVALID_IMAGE_URL",
              "VARIANT_IMAGE_NOT_ASSIGNED",
              "VARIANT_IMAGE_NOT_READY",
              "VARIANT_IMAGE_MISMATCH",
            ].includes(issue.code),
          ),
        ),
      ).length,
    },
    orders: job.pending.map((order) => ({
      key: order.deterministicKey,
      source: order.sourceOrderName ?? order.sourceOrderId,
      imageUrl: order.lineItems.find((line) => line.imageUrl)?.imageUrl ?? null,
      detailsHref: `/app/preview/order?job=${encodeURIComponent(job.id)}&order=${encodeURIComponent(order.deterministicKey)}`,
      customerName:
        order.customerName?.trim() ||
        customerProfiles
          .get(order.customerEmail?.trim().toLowerCase() ?? "")
          ?.displayName?.trim() ||
        null,
      email: order.customerEmail ?? "Missing",
      date: order.processedAt?.toISOString() ?? null,
      items: order.lineItems.length,
      fulfillmentStatus: order.fulfillmentStatus ?? "Fulfilled",
      shippingCharge: order.shippingCharge,
      total: order.lineItems.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        order.shippingCharge,
      ),
      blocked: hasBlockingIssues(order),
      issue: order.issues[0]?.message ?? "Ready",
      searchText: [
        order.sourceOrderName,
        order.sourceOrderId,
        order.customerName,
        order.customerEmail,
        ...order.lineItems.flatMap((line) => [
          line.productTitle,
          line.variantTitle,
          line.variantId,
          line.sku,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const job = getEphemeralJob(session.shop, String(form.get("jobId") || ""));
  if (!job)
    return Response.json({ error: "Import not found." }, { status: 404 });
  if (job.status === "RUNNING") {
    return Response.json(
      { error: "An import is already running." },
      { status: 409 },
    );
  }
  if (intent === "clear-import") {
    clearEphemeralJob(session.shop, job.id);
    return Response.json({ cleared: true });
  }
  if (intent === "mark-unfulfilled") {
    const orderNumbers = String(form.get("orderNumbers") || "");
    const result = markOrdersUnfulfilled(job, orderNumbers);
    if (!result.requested) {
      return Response.json(
        { error: "Enter at least one order number." },
        { status: 400 },
      );
    }
    if (!result.marked) {
      return Response.json(
        {
          error:
            "None of those order numbers were found in this pending import.",
          ...result,
        },
        { status: 400 },
      );
    }
    return Response.json(result);
  }
  const selectedOrderKeys = [
    ...new Set(
      form
        .getAll("selectedOrderKey")
        .map(String)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  const selectedReadyOrders = getSelectedReadyOrders(job, selectedOrderKeys);
  if (!selectedReadyOrders.length) {
    return Response.json(
      { error: "Select at least one ready order." },
      { status: 400 },
    );
  }
  void importReadyOrders(job, admin, selectedOrderKeys);
  return Response.json({
    started: true,
    selectedOrders: selectedReadyOrders.length,
  });
}

export default function PreviewOrders() {
  const data = useLoaderData<typeof loader>();
  const importer = useFetcher();
  const clearer = useFetcher();
  const fulfillmentUpdater = useFetcher();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<string[]>([]);
  const [bulkOrderNumbers, setBulkOrderNumbers] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [downloadingPendingExcel, setDownloadingPendingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const importing = importer.state !== "idle" || data.job?.status === "RUNNING";
  const clearing = clearer.state !== "idle";
  const updatingFulfillment = fulfillmentUpdater.state !== "idle";
  const readyOrderKeys = useMemo(
    () =>
      data.orders.filter((order) => !order.blocked).map((order) => order.key),
    [data.orders],
  );
  const readyOrderKeySet = useMemo(
    () => new Set(readyOrderKeys),
    [readyOrderKeys],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOrders = useMemo(
    () =>
      data.orders.filter((order) => {
        const matchesSearch =
          !normalizedSearchQuery ||
          order.searchText.includes(normalizedSearchQuery);
        const matchesFulfillment =
          fulfillmentFilter === "all" ||
          order.fulfillmentStatus === fulfillmentFilter;
        const matchesReadiness =
          readinessFilter === "all" ||
          (readinessFilter === "ready" ? !order.blocked : order.blocked);
        return matchesSearch && matchesFulfillment && matchesReadiness;
      }),
    [data.orders, fulfillmentFilter, normalizedSearchQuery, readinessFilter],
  );
  const visibleReadyOrderKeys = useMemo(
    () =>
      filteredOrders
        .filter((order) => !order.blocked)
        .map((order) => order.key),
    [filteredOrders],
  );
  const fulfillmentOptions = useMemo(
    () =>
      [...new Set(data.orders.map((order) => order.fulfillmentStatus))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [data.orders],
  );
  const selectedReadyOrderKeys = useMemo(
    () => selectedOrderKeys.filter((key) => readyOrderKeySet.has(key)),
    [readyOrderKeySet, selectedOrderKeys],
  );
  const selectedOrderKeySet = useMemo(
    () => new Set(selectedReadyOrderKeys),
    [selectedReadyOrderKeys],
  );
  const selectedCount = selectedReadyOrderKeys.length;
  const allReadySelected =
    visibleReadyOrderKeys.length > 0 &&
    visibleReadyOrderKeys.every((key) => selectedOrderKeySet.has(key));
  const importerError = (importer.data as { error?: string } | undefined)
    ?.error;
  const clearerData = clearer.data as
    { cleared?: boolean; error?: string } | undefined;
  const fulfillmentUpdateData = fulfillmentUpdater.data as
    | {
        marked?: number;
        notFound?: string[];
        error?: string;
      }
    | undefined;

  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 800);
    return () => window.clearInterval(timer);
  }, [importing, revalidator]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    const visibleSelectedCount = visibleReadyOrderKeys.filter((key) =>
      selectedOrderKeySet.has(key),
    ).length;
    selectAllRef.current.indeterminate =
      visibleSelectedCount > 0 &&
      visibleSelectedCount < visibleReadyOrderKeys.length;
  }, [selectedOrderKeySet, visibleReadyOrderKeys]);

  useEffect(() => {
    if (clearerData?.cleared) {
      navigate("/app/import/new", { replace: true });
    }
  }, [clearerData?.cleared, navigate]);

  if (!data.job) {
    return (
      <s-page heading="Pending orders">
        <s-empty-state heading="No active import">
          <s-button href="/app/import/new">Upload workbook</s-button>
        </s-empty-state>
      </s-page>
    );
  }
  const confirmationMatches = confirmation.trim().toUpperCase() === "YES";
  const pendingExcelHref = `/app/api/export-pending-xlsx?job=${encodeURIComponent(data.job.id)}`;
  const pendingExcelFilename = `pending-orders-${data.job.id}.xlsx`;

  function toggleOrder(key: string, checked: boolean) {
    setSelectedOrderKeys((current) => {
      if (checked) {
        return current.includes(key) ? current : [...current, key];
      }
      return current.filter((candidate) => candidate !== key);
    });
  }

  function toggleAllReadyOrders(checked: boolean) {
    const visibleReadySet = new Set(visibleReadyOrderKeys);
    setSelectedOrderKeys((current) =>
      checked
        ? [...new Set([...current, ...visibleReadyOrderKeys])]
        : current.filter((key) => !visibleReadySet.has(key)),
    );
  }

  async function downloadPendingExcel() {
    if (downloadingPendingExcel) return;
    setDownloadingPendingExcel(true);
    setDownloadError(null);

    try {
      const response = await fetch(pendingExcelHref, {
        credentials: "same-origin",
        headers: { Accept: XLSX_CONTENT_TYPE },
      });
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "This pending import has expired. Upload the workbook again."
            : "The pending Excel file could not be generated. Please try again.",
        );
      }
      if (
        response.redirected ||
        !isExcelResponse(response.headers.get("Content-Type"))
      ) {
        throw new Error(
          "Your Shopify session may have expired. Refresh the app and try again.",
        );
      }

      const workbook = await response.blob();
      if (!workbook.size) {
        throw new Error(
          "The generated Excel file was empty. Please try again.",
        );
      }

      const filename = getAttachmentFilename(
        response.headers.get("Content-Disposition"),
        pendingExcelFilename,
      );
      const objectUrl = URL.createObjectURL(workbook);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "The pending Excel file could not be downloaded.",
      );
    } finally {
      setDownloadingPendingExcel(false);
    }
  }

  function startImport() {
    if (!confirmationMatches || !data.job || selectedCount === 0) return;
    const form = new FormData();
    form.append("jobId", data.job.id);
    selectedReadyOrderKeys.forEach((key) =>
      form.append("selectedOrderKey", key),
    );
    confirmationDialog.current?.close();
    setConfirmation("");
    importer.submit(form, { method: "post" });
  }

  function clearCurrentImport() {
    if (!data.job || importing || clearing) return;
    const confirmed = window.confirm(
      `Clear "${data.job.fileName}" and remove all ${data.orders.length} pending orders from this temporary import? This cannot be undone.`,
    );
    if (!confirmed) return;

    const form = new FormData();
    form.append("intent", "clear-import");
    form.append("jobId", data.job.id);
    clearer.submit(form, { method: "post" });
  }

  function markPastedOrdersUnfulfilled() {
    if (!data.job || updatingFulfillment || !bulkOrderNumbers.trim()) return;
    const form = new FormData();
    form.append("intent", "mark-unfulfilled");
    form.append("jobId", data.job.id);
    form.append("orderNumbers", bulkOrderNumbers);
    fulfillmentUpdater.submit(form, { method: "post" });
  }

  return (
    <s-page heading={`Pending — ${data.job.fileName}`}>
      <s-section>
        <div className="kdc-import-header">
          <h2>Ephemeral import status</h2>
          <div className="kdc-import-actions">
            <s-button
              disabled={importing || clearing}
              onClick={clearCurrentImport}
            >
              {clearing ? "Clearing…" : "Clear current import"}
            </s-button>
            <span className="kdc-selected-count" aria-live="polite">
              {selectedCount} of {data.job.readyOrders} selected
            </span>
            <s-button
              disabled={downloadingPendingExcel}
              onClick={() => void downloadPendingExcel()}
            >
              {downloadingPendingExcel
                ? "Preparing Excel…"
                : "Download pending Excel"}
            </s-button>
            <s-button
              variant="primary"
              disabled={importing || selectedCount === 0}
              onClick={() => confirmationDialog.current?.showModal()}
            >
              {importing ? "Importing…" : "Import selected orders"}
            </s-button>
          </div>
        </div>
        <s-banner tone={data.job.status === "COMPLETED" ? "success" : "info"}>
          {data.job.currentMessage}. Successfully imported orders are removed
          immediately.
        </s-banner>
        {importerError ? (
          <s-banner tone="critical">{importerError}</s-banner>
        ) : null}
        {clearerData?.error ? (
          <s-banner tone="critical">{clearerData.error}</s-banner>
        ) : null}
        {fulfillmentUpdateData?.error ? (
          <s-banner tone="critical">{fulfillmentUpdateData.error}</s-banner>
        ) : fulfillmentUpdateData?.marked ? (
          <s-banner
            tone={
              fulfillmentUpdateData.notFound?.length ? "warning" : "success"
            }
          >
            Marked {fulfillmentUpdateData.marked} order(s) Unfulfilled.
            {fulfillmentUpdateData.notFound?.length
              ? ` Not found: ${fulfillmentUpdateData.notFound.join(", ")}.`
              : ""}
          </s-banner>
        ) : null}
        {downloadError ? (
          <s-banner tone="critical">{downloadError}</s-banner>
        ) : null}
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          gap="base"
        >
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Original orders</s-text>
            <s-heading>{data.job.totalOrders}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Imported</s-text>
            <s-heading>{data.job.importedOrders}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Pending</s-text>
            <s-heading>{data.orders.length}</s-heading>
          </s-box>
        </s-grid>
        <div className="kdc-bulk-fulfillment">
          <label htmlFor="bulk-unfulfilled-orders">
            <strong>Mark multiple orders Unfulfilled</strong>
            <span>
              Paste order numbers separated by commas, spaces, or new lines.
              This marks them not shipped and keeps them ready to import.
            </span>
          </label>
          <textarea
            id="bulk-unfulfilled-orders"
            className="kdc-textarea"
            rows={3}
            value={bulkOrderNumbers}
            disabled={importing || clearing || updatingFulfillment}
            placeholder="#1674, #1673, #1671, #1670"
            onChange={(event) => setBulkOrderNumbers(event.currentTarget.value)}
          />
          <div className="kdc-form-actions">
            <s-button
              disabled={
                importing ||
                clearing ||
                updatingFulfillment ||
                !bulkOrderNumbers.trim()
              }
              onClick={markPastedOrdersUnfulfilled}
            >
              {updatingFulfillment
                ? "Updating fulfillment…"
                : "Mark as Unfulfilled"}
            </s-button>
          </div>
        </div>
      </s-section>
      <dialog
        ref={confirmationDialog}
        className="kdc-confirm-dialog"
        onClose={() => setConfirmation("")}
      >
        <div className="kdc-confirm-dialog__header">
          <div>
            <span className="kdc-order-detail-label">Final confirmation</span>
            <h2>Import selected orders?</h2>
          </div>
          <button
            className="kdc-dialog-close"
            type="button"
            aria-label="Close confirmation"
            onClick={() => confirmationDialog.current?.close()}
          >
            ×
          </button>
        </div>
        <p>
          Review the counts and download the pending workbook before importing.
          Successfully imported orders will be removed from this temporary list.
        </p>
        <div className="kdc-confirm-counts">
          <div className="kdc-confirm-count kdc-confirm-count--ready">
            <span>Selected ready orders</span>
            <strong>{selectedCount}</strong>
          </div>
          <div className="kdc-confirm-count kdc-confirm-count--blocked">
            <span>Image validation errors</span>
            <strong>{data.job.imageValidationErrorOrders}</strong>
          </div>
          <div className="kdc-confirm-count">
            <span>Total pending</span>
            <strong>{data.orders.length}</strong>
          </div>
        </div>
        <label className="kdc-confirm-label" htmlFor="confirm-import">
          Type <strong>YES</strong> to import {selectedCount} selected order(s)
        </label>
        <input
          id="confirm-import"
          className="kdc-text-input"
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
          autoComplete="off"
          placeholder="Type YES"
        />
        <div className="kdc-confirm-dialog__actions">
          <s-button
            disabled={downloadingPendingExcel}
            onClick={() => void downloadPendingExcel()}
          >
            {downloadingPendingExcel
              ? "Preparing Excel…"
              : "Download pending Excel"}
          </s-button>
          <s-button
            variant="primary"
            disabled={!confirmationMatches || selectedCount === 0}
            onClick={startImport}
          >
            Confirm import
          </s-button>
        </div>
      </dialog>
      <s-section heading="Pending only">
        <div className="kdc-pending-filters">
          <label className="kdc-pending-search" htmlFor="pending-order-search">
            <span>Search orders</span>
            <input
              id="pending-order-search"
              className="kdc-text-input"
              type="search"
              value={searchQuery}
              placeholder="Order, customer, email, product, SKU, or variant ID"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
            />
          </label>
          <label htmlFor="pending-fulfillment-filter">
            <span>Fulfillment Status</span>
            <select
              id="pending-fulfillment-filter"
              className="kdc-filter-select"
              value={fulfillmentFilter}
              onChange={(event) =>
                setFulfillmentFilter(event.currentTarget.value)
              }
            >
              <option value="all">All fulfillment statuses</option>
              {fulfillmentOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="pending-readiness-filter">
            <span>Ready Status</span>
            <select
              id="pending-readiness-filter"
              className="kdc-filter-select"
              value={readinessFilter}
              onChange={(event) =>
                setReadinessFilter(event.currentTarget.value)
              }
            >
              <option value="all">All ready statuses</option>
              <option value="ready">Ready</option>
              <option value="not-ready">Not Ready</option>
            </select>
          </label>
          <div className="kdc-filter-summary" aria-live="polite">
            Showing {filteredOrders.length} of {data.orders.length} orders
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="kdc-table">
            <thead>
              <tr>
                <th className="kdc-select-cell">
                  <label className="kdc-selection-control">
                    <input
                      ref={selectAllRef}
                      className="kdc-order-checkbox"
                      type="checkbox"
                      checked={allReadySelected}
                      disabled={importing || visibleReadyOrderKeys.length === 0}
                      aria-label="Select all visible ready orders"
                      onChange={(event) =>
                        toggleAllReadyOrders(event.currentTarget.checked)
                      }
                    />
                  </label>
                </th>
                <th>Order</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Items</th>
                <th>Shipping</th>
                <th>Total</th>
                <th>Fulfillment</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.key}
                  className={
                    selectedOrderKeySet.has(order.key)
                      ? "kdc-table-row--selected"
                      : undefined
                  }
                >
                  <td className="kdc-select-cell">
                    <input
                      className="kdc-order-checkbox"
                      type="checkbox"
                      checked={selectedOrderKeySet.has(order.key)}
                      disabled={importing || order.blocked}
                      aria-label={`Select ${order.source}`}
                      title={
                        order.blocked
                          ? "Resolve this order's errors before selecting it"
                          : undefined
                      }
                      onChange={(event) =>
                        toggleOrder(order.key, event.currentTarget.checked)
                      }
                    />
                  </td>
                  <td>
                    <div className="kdc-order-source">
                      {order.imageUrl ? (
                        <img
                          className="kdc-order-thumbnail"
                          src={order.imageUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="kdc-order-thumbnail kdc-order-thumbnail--empty">
                          No image
                        </span>
                      )}
                      <Link to={order.detailsHref} prefetch="intent">
                        {order.source}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <div className="kdc-customer-cell">
                      {order.customerName ? (
                        <strong>{order.customerName}</strong>
                      ) : null}
                      <span>{order.email}</span>
                    </div>
                  </td>
                  <td>
                    {order.date
                      ? new Date(order.date).toLocaleDateString()
                      : "—"}
                  </td>
                  <td>{order.items}</td>
                  <td>₹{order.shippingCharge.toFixed(2)}</td>
                  <td>₹{order.total.toFixed(2)}</td>
                  <td>{order.fulfillmentStatus}</td>
                  <td>{order.blocked ? "Not Ready" : "Ready"}</td>
                  <td className="kdc-issue">{order.issue}</td>
                </tr>
              ))}
              {!filteredOrders.length ? (
                <tr>
                  <td className="kdc-table-empty" colSpan={10}>
                    No pending orders match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}
