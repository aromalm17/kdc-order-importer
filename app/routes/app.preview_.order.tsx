import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clearLegacyCustomerShippingAddressIssues,
  getCachedCustomerProfiles,
  getEphemeralJob,
} from "../services/ephemeral-imports.server";
import { hasBlockingIssues } from "../services/workbook.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const job = getEphemeralJob(session.shop, url.searchParams.get("job"));
  const orderKey = url.searchParams.get("order");
  const orderIndex =
    job?.pending.findIndex(
      (candidate) => candidate.deterministicKey === orderKey,
    ) ?? -1;
  const order = job?.pending.find(
    (candidate) => candidate.deterministicKey === orderKey,
  );

  if (!job || !order) {
    return {
      jobId: job?.id ?? null,
      order: null,
      previousOrderKey: null,
      nextOrderKey: null,
    };
  }
  const customerProfiles = await getCachedCustomerProfiles(job, admin, [
    order.customerEmail,
  ]);
  clearLegacyCustomerShippingAddressIssues([order]);
  const customer = customerProfiles.get(
    order.customerEmail?.trim().toLowerCase() ?? "",
  );
  const shippingAddress = customer?.defaultAddress;

  return {
    jobId: job.id,
    previousOrderKey:
      orderIndex > 0 ? job.pending[orderIndex - 1].deterministicKey : null,
    nextOrderKey:
      orderIndex < job.pending.length - 1
        ? job.pending[orderIndex + 1].deterministicKey
        : null,
    order: {
      source: order.sourceOrderName ?? order.sourceOrderId,
      customerName: order.customerName ?? customer?.displayName ?? "—",
      customerEmail: order.customerEmail ?? customer?.email ?? "—",
      customerPhone: order.customerPhone ?? customer?.phone ?? "—",
      shippingAddress: shippingAddress ?? null,
      shippingAddressSource: shippingAddress
        ? "Shopify customer default address"
        : null,
      billingAddress: order.billingAddress ?? null,
      note: order.note ?? null,
      tags: order.tags,
      processedAt: order.processedAt?.toISOString() ?? null,
      currency: order.currency,
      financialStatus: order.financialStatus ?? "—",
      fulfillmentStatus: order.fulfillmentStatus ?? "—",
      shippingCharge: order.shippingCharge,
      blocked: hasBlockingIssues(order),
      issues: order.issues.map((issue) => issue.message),
      total: order.lineItems.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        order.shippingCharge,
      ),
      itemQuantity: order.lineItems.reduce(
        (sum, line) => sum + line.quantity,
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
  const navigate = useNavigate();
  const backHref = data.jobId
    ? `/app/preview?job=${encodeURIComponent(data.jobId)}`
    : "/app/preview";
  const orderHref = (orderKey: string) =>
    `/app/preview/order?job=${encodeURIComponent(data.jobId ?? "")}&order=${encodeURIComponent(orderKey)}`;

  if (!data.order) {
    return (
      <s-page heading="Order unavailable">
        <s-empty-state heading="This order is no longer pending">
          <s-paragraph>
            It may have imported successfully or the temporary import may have
            expired.
          </s-paragraph>
          <s-button onClick={() => navigate(backHref)}>
            Back to pending orders
          </s-button>
        </s-empty-state>
      </s-page>
    );
  }

  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: data.order.currency || "INR",
  });

  return (
    <s-page heading={`Order ${data.order.source}`}>
      <s-button slot="secondary-actions" onClick={() => navigate(backHref)}>
        Back to pending orders
      </s-button>
      <s-button
        slot="secondary-actions"
        icon="chevron-left"
        accessibilityLabel="Previous order"
        disabled={!data.previousOrderKey}
        onClick={() => {
          if (data.previousOrderKey) {
            navigate(orderHref(data.previousOrderKey));
          }
        }}
      />
      <s-button
        slot="secondary-actions"
        icon="chevron-right"
        accessibilityLabel="Next order"
        disabled={!data.nextOrderKey}
        onClick={() => {
          if (data.nextOrderKey) navigate(orderHref(data.nextOrderKey));
        }}
      />

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
            <span className="kdc-order-detail-label">Order status</span>
            <div className="kdc-detail-status-row">
              <span
                className={`kdc-status ${
                  data.order.blocked
                    ? "kdc-status--blocked"
                    : "kdc-status--ready"
                }`}
              >
                {data.order.blocked ? "Not Ready" : "Ready"}
              </span>
            </div>
            <div>Payment: {data.order.financialStatus}</div>
            <div>Fulfillment: {data.order.fulfillmentStatus}</div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Order total</span>
            <strong className="kdc-detail-total">
              {money.format(data.order.total)}
            </strong>
            <div>
              {data.order.itemQuantity} item(s) across{" "}
              {data.order.lineItems.length} line(s)
            </div>
            <div>Shipping: {money.format(data.order.shippingCharge)}</div>
          </div>
        </div>
        {data.order.issues.length ? (
          <s-banner tone="critical">{data.order.issues.join(" · ")}</s-banner>
        ) : null}
      </s-section>

      <s-section heading="Customer and addresses">
        <div className="kdc-address-grid">
          <div className="kdc-address-card">
            <span className="kdc-order-detail-label">Shipping address</span>
            <p>
              {data.order.shippingAddress ??
                "Not available in the workbook or Shopify customer profile."}
            </p>
            {data.order.shippingAddressSource ? (
              <span className="kdc-address-source">
                Source: {data.order.shippingAddressSource}
              </span>
            ) : null}
          </div>
          <div className="kdc-address-card">
            <span className="kdc-order-detail-label">Billing address</span>
            <p>
              {data.order.billingAddress ?? "Not supplied in this workbook."}
            </p>
          </div>
        </div>
        {data.order.note ? (
          <div className="kdc-order-note">
            <span className="kdc-order-detail-label">Order note</span>
            <p>{data.order.note}</p>
          </div>
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
                          loading="lazy"
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
                  <td>{money.format(line.unitPrice)}</td>
                  <td>{money.format(line.lineTotal)}</td>
                  <td className={line.issues.length ? "kdc-issue" : ""}>
                    {line.issues.length ? line.issues.join(" · ") : "Verified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kdc-detail-summary">
          <span>Workbook order total</span>
          <strong>{money.format(data.order.total)}</strong>
        </div>
      </s-section>
    </s-page>
  );
}
