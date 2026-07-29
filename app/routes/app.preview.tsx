import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
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
  return (
    <s-page heading={`Pending — ${data.job.fileName}`}>
      <importer.Form method="post">
        <input type="hidden" name="jobId" value={data.job.id} />
        <s-button slot="primary-action" type="submit" variant="primary" disabled={importing}>
          {importing ? "Importing…" : "Import ready orders"}
        </s-button>
      </importer.Form>
      <s-button slot="secondary-actions" href={`/app/api/export-errors?job=${data.job.id}`}>Download pending CSV</s-button>
      <s-section heading="Ephemeral import status">
        <s-banner tone={data.job.status === "COMPLETED" ? "success" : "info"}>
          {data.job.currentMessage}. Successfully imported orders are removed immediately.
        </s-banner>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Original orders</s-text><s-heading>{data.job.totalOrders}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Imported</s-text><s-heading>{data.job.importedOrders}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text>Pending</s-text><s-heading>{data.orders.length}</s-heading></s-box>
        </s-grid>
      </s-section>
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
                    <a href={order.detailsHref}>{order.source}</a>
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
