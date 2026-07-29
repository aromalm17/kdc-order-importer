import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getEphemeralJob } from "../services/ephemeral-imports.server";
import { hasBlockingIssues } from "../services/workbook.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const job = getEphemeralJob(session.shop, url.searchParams.get("job"));
  const orderKey = url.searchParams.get("order");
  const order = job?.pending.find(
    (candidate) => candidate.deterministicKey === orderKey,
  );

  if (!job || !order) {
    return { jobId: job?.id ?? null, order: null };
  }

  return {
    jobId: job.id,
    order: {
      source: order.sourceOrderName ?? order.sourceOrderId,
      customerName: order.customerName ?? "—",
      customerEmail: order.customerEmail ?? "—",
      customerPhone: order.customerPhone ?? "—",
      processedAt: order.processedAt?.toISOString() ?? null,
      currency: order.currency,
      financialStatus: order.financialStatus ?? "—",
      fulfillmentStatus: order.fulfillmentStatus ?? "—",
      blocked: hasBlockingIssues(order),
      issues: order.issues.map((issue) => issue.message),
      total: order.lineItems.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        0,
      ),
      lineItems: order.lineItems.map((line) => ({
        row: line.sourceRowNumber,
        title: line.productTitle,
        variantTitle: line.variantTitle ?? "",
        sku: line.sku ?? "—",
        variantId:
          line.variantId?.replace("gid://shopify/ProductVariant/", "") ?? "—",
        imageUrl: line.imageUrl ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.unitPrice * line.quantity,
        issues: line.issues.map((issue) => issue.message),
      })),
    },
  };
}

export default function PendingOrderDetail() {
  const data = useLoaderData<typeof loader>();
  const backHref = data.jobId
    ? `/app/preview?job=${encodeURIComponent(data.jobId)}`
    : "/app/preview";

  if (!data.order) {
    return (
      <s-page heading="Order unavailable">
        <s-empty-state heading="This order is no longer pending">
          <s-paragraph>
            It may have imported successfully or the temporary import may have
            expired.
          </s-paragraph>
          <s-button href={backHref}>Back to pending orders</s-button>
        </s-empty-state>
      </s-page>
    );
  }

  return (
    <s-page heading={`Order ${data.order.source}`}>
      <s-button slot="secondary-actions" href={backHref}>
        Back to pending orders
      </s-button>

      <s-section heading="Order verification">
        <s-banner tone={data.order.blocked ? "critical" : "success"}>
          {data.order.blocked
            ? "This order has blocking issues and will not be imported."
            : "This complete order is ready to import."}
        </s-banner>
        <div className="kdc-order-detail-grid">
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Customer</span>
            <strong>{data.order.customerName}</strong>
            <div>{data.order.customerEmail}</div>
            <div>{data.order.customerPhone}</div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Order date</span>
            <strong>
              {data.order.processedAt
                ? new Date(data.order.processedAt).toLocaleString()
                : "—"}
            </strong>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Source status</span>
            <div>Payment: {data.order.financialStatus}</div>
            <div>Fulfillment: {data.order.fulfillmentStatus}</div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Order total</span>
            <strong>
              {data.order.currency} {data.order.total.toFixed(2)}
            </strong>
            <div>{data.order.lineItems.length} line item(s)</div>
          </div>
        </div>
        {data.order.issues.length ? (
          <s-banner tone="critical">
            {data.order.issues.join(" · ")}
          </s-banner>
        ) : null}
      </s-section>

      <s-section heading={`All items (${data.order.lineItems.length})`}>
        <div style={{ overflowX: "auto" }}>
          <table className="kdc-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Variant ID</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {data.order.lineItems.map((line) => (
                <tr key={`${line.row}-${line.variantId}`}>
                  <td>
                    <div className="kdc-line-product">
                      {line.imageUrl ? (
                        <img
                          className="kdc-line-thumbnail"
                          src={line.imageUrl}
                          alt=""
                        />
                      ) : (
                        <span className="kdc-line-thumbnail kdc-order-thumbnail--empty">
                          No image
                        </span>
                      )}
                      <div className="kdc-line-meta">
                        <strong>{line.title}</strong>
                        {line.variantTitle ? (
                          <span>{line.variantTitle}</span>
                        ) : null}
                        <span className="kdc-muted">Source row {line.row}</span>
                      </div>
                    </div>
                  </td>
                  <td>{line.sku}</td>
                  <td>{line.variantId}</td>
                  <td>{line.quantity}</td>
                  <td>₹{line.unitPrice.toFixed(2)}</td>
                  <td>₹{line.lineTotal.toFixed(2)}</td>
                  <td className={line.issues.length ? "kdc-issue" : ""}>
                    {line.issues.length ? line.issues.join(" · ") : "Verified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}
