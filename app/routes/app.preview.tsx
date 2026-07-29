import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import {
  getEphemeralJob,
  importReadyOrders,
} from "../services/ephemeral-imports.server";
import { hasBlockingIssues } from "../services/workbook.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("job");
  const job = getEphemeralJob(session.shop, id);
  if (!job) return { job: null, orders: [] };
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
      missingImageOrders: job.pending.filter((order) =>
        order.lineItems.some((line) =>
          line.issues.some((issue) =>
            ["MISSING_IMAGE", "INVALID_IMAGE_URL"].includes(issue.code),
          ),
        ),
      ).length,
    },
    orders: job.pending.map((order) => ({
      key: order.deterministicKey,
      source: order.sourceOrderName ?? order.sourceOrderId,
      imageUrl: order.lineItems.find((line) => line.imageUrl)?.imageUrl ?? null,
      detailsHref: `/app/preview/order?job=${encodeURIComponent(job.id)}&order=${encodeURIComponent(order.deterministicKey)}`,
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
  if (!job) return Response.json({ error: "Import not found." }, { status: 404 });
  void importReadyOrders(job, admin);
  return Response.json({ started: true });
}

export default function PreviewOrders() {
  const data = useLoaderData<typeof loader>();
  const importer = useFetcher();
  const revalidator = useRevalidator();
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const importing =
    importer.state !== "idle" || data.job?.status === "RUNNING";

  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 800);
    return () => window.clearInterval(timer);
  }, [importing, revalidator]);

  if (!data.job) {
    return <s-page heading="Pending orders"><s-empty-state heading="No active import"><s-button href="/app/import/new">Upload workbook</s-button></s-empty-state></s-page>;
  }
  const confirmationMatches = confirmation.trim().toUpperCase() === "YES";
  const pendingExcelHref = `/app/api/export-pending-xlsx?job=${encodeURIComponent(data.job.id)}`;

  function startImport() {
    if (!confirmationMatches || !data.job?.readyOrders) return;
    confirmationDialog.current?.close();
    setConfirmation("");
    importer.submit({ jobId: data.job.id }, { method: "post" });
  }

  return (
    <s-page heading={`Pending — ${data.job.fileName}`}>
      <s-section heading="Ephemeral import status">
        <div className="kdc-import-actions">
          <s-button href={pendingExcelHref}>Download pending Excel</s-button>
          <s-button
            variant="primary"
            disabled={importing || data.job.readyOrders === 0}
            onClick={() => confirmationDialog.current?.showModal()}
          >
            {importing ? "Importing…" : "Import ready orders"}
          </s-button>
        </div>
        <s-banner tone={data.job.status === "COMPLETED" ? "success" : "info"}>
          {data.job.currentMessage}. Successfully imported orders are removed immediately.
        </s-banner>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Original orders</s-text><s-heading>{data.job.totalOrders}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Imported</s-text><s-heading>{data.job.importedOrders}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Pending</s-text><s-heading>{data.orders.length}</s-heading></s-box>
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
            <h2>Import ready orders?</h2>
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
            <span>Ready orders</span>
            <strong>{data.job.readyOrders}</strong>
          </div>
          <div className="kdc-confirm-count kdc-confirm-count--blocked">
            <span>Missing/invalid image orders</span>
            <strong>{data.job.missingImageOrders}</strong>
          </div>
          <div className="kdc-confirm-count">
            <span>Total pending</span>
            <strong>{data.orders.length}</strong>
          </div>
        </div>
        <label className="kdc-confirm-label" htmlFor="confirm-import">
          Type <strong>YES</strong> to import {data.job.readyOrders} ready
          order(s)
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
          <s-button href={pendingExcelHref}>Download pending Excel</s-button>
          <s-button
            variant="primary"
            disabled={!confirmationMatches || data.job.readyOrders === 0}
            onClick={startImport}
          >
            Confirm import
          </s-button>
        </div>
      </dialog>
      <s-section heading="Pending only">
        <div style={{ overflowX: "auto" }}>
          <table className="kdc-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>{data.orders.map((order) => (
              <tr key={order.key}>
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
                </td><td>{order.email}</td>
                <td>{order.date ? new Date(order.date).toLocaleDateString() : "—"}</td>
                <td>{order.items}</td><td>₹{order.total.toFixed(2)}</td>
                <td>{order.blocked ? "Blocked" : "Ready"}</td>
                <td className="kdc-issue">{order.issue}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}
