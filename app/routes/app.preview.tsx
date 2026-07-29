import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getSelectedReadyOrders,
  getEphemeralJob,
  importReadyOrders,
} from "../services/ephemeral-imports.server";
import { findCustomerNamesByEmail } from "../services/shopify-orders.server";
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
  const customerNames = await findCustomerNamesByEmail(
    admin,
    job.pending
      .filter((order) => !order.customerName)
      .map((order) => order.customerEmail),
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
        customerNames.get(order.customerEmail?.trim().toLowerCase() ?? "") ||
        null,
      email: order.customerEmail ?? "Missing",
      date: order.processedAt?.toISOString() ?? null,
      items: order.lineItems.length,
      total: order.lineItems.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      ),
      blocked: hasBlockingIssues(order),
      issue: order.issues[0]?.message ?? "Ready",
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const job = getEphemeralJob(session.shop, String(form.get("jobId") || ""));
  if (!job)
    return Response.json({ error: "Import not found." }, { status: 404 });
  if (job.status === "RUNNING") {
    return Response.json(
      { error: "An import is already running." },
      { status: 409 },
    );
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
  const revalidator = useRevalidator();
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<string[]>([]);
  const [downloadingPendingExcel, setDownloadingPendingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const importing = importer.state !== "idle" || data.job?.status === "RUNNING";
  const readyOrderKeys = data.orders
    .filter((order) => !order.blocked)
    .map((order) => order.key);
  const readyOrderKeySet = new Set(readyOrderKeys);
  const selectedReadyOrderKeys = selectedOrderKeys.filter((key) =>
    readyOrderKeySet.has(key),
  );
  const selectedOrderKeySet = new Set(selectedReadyOrderKeys);
  const selectedCount = selectedReadyOrderKeys.length;
  const allReadySelected =
    readyOrderKeys.length > 0 && selectedCount === readyOrderKeys.length;
  const importerError = (importer.data as { error?: string } | undefined)
    ?.error;

  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 800);
    return () => window.clearInterval(timer);
  }, [importing, revalidator]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate =
      selectedCount > 0 && selectedCount < readyOrderKeys.length;
  }, [readyOrderKeys.length, selectedCount]);

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
    setSelectedOrderKeys(checked ? readyOrderKeys : []);
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
        throw new Error("The generated Excel file was empty. Please try again.");
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

  return (
    <s-page heading={`Pending — ${data.job.fileName}`}>
      <s-section>
        <div className="kdc-import-header">
          <h2>Ephemeral import status</h2>
          <div className="kdc-import-actions">
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
                      disabled={importing || readyOrderKeys.length === 0}
                      aria-label="Select all ready orders"
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
                <th>Total</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
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
                  <td>₹{order.total.toFixed(2)}</td>
                  <td>{order.blocked ? "Blocked" : "Ready"}</td>
                  <td className="kdc-issue">{order.issue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}
