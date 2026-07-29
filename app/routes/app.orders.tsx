import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listManagedOrders } from "../services/shopify-order-manager.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const after = url.searchParams.get("after");
  const deleted = url.searchParams.get("deleted");
  const result = await listManagedOrders(admin, {
    after,
    query: search,
    first: 50,
  });
  return { ...result, search, after, deleted };
}

function money(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount));
}

function FulfillmentStatus({ status }: { status: string }) {
  const normalized = status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const label = normalized
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
  let tone = "neutral";
  if (normalized === "FULFILLED") tone = "fulfilled";
  else if (normalized.includes("PARTIAL")) tone = "partial";
  else if (normalized === "UNFULFILLED") tone = "unfulfilled";
  else if (
    normalized.includes("PROGRESS") ||
    normalized.includes("SCHEDULED")
  ) {
    tone = "progress";
  } else if (normalized.includes("HOLD") || normalized.includes("PENDING")) {
    tone = "pending";
  }
  return (
    <span className={`kdc-fulfillment-status kdc-fulfillment-status--${tone}`}>
      {label || "Unknown"}
    </span>
  );
}

export default function ShopifyOrders() {
  const data = useLoaderData<typeof loader>();
  const nextParams = new URLSearchParams();
  if (data.search) nextParams.set("q", data.search);
  if (data.pageInfo.endCursor) {
    nextParams.set("after", data.pageInfo.endCursor);
  }

  return (
    <s-page heading="Shopify orders">
      <s-button slot="primary-action" href="/app/orders">
        Refresh orders
      </s-button>
      <s-section>
        {data.deleted ? (
          <s-banner tone="success">
            {data.deleted} was permanently deleted from Shopify.
          </s-banner>
        ) : null}
        <div className="kdc-managed-toolbar">
          <div>
            <h2>Orders in Shopify</h2>
            <p>
              Browse up to 50 orders per page. Search by order number, customer,
              email, product, or Shopify order search syntax.
            </p>
          </div>
          <Form method="get" className="kdc-managed-search">
            <label htmlFor="managed-order-search">Search orders</label>
            <div>
              <input
                id="managed-order-search"
                className="kdc-text-input"
                name="q"
                defaultValue={data.search}
                placeholder="#1001 or customer email"
              />
              <button className="kdc-native-button" type="submit">
                Search
              </button>
              {data.search ? (
                <Link className="kdc-secondary-link" to="/app/orders">
                  Clear
                </Link>
              ) : null}
            </div>
          </Form>
        </div>
        <s-banner tone="info">
          Product and shipping edits follow Shopify&apos;s order-edit rules.
          Fulfilled, archived, cancelled, international-currency, or otherwise
          restricted orders might be view-only.
        </s-banner>
      </s-section>

      <s-section heading={`${data.orders.length} orders on this page`}>
        {data.orders.length ? (
          <div className="kdc-table-wrap">
            <table className="kdc-table kdc-managed-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Fulfillment</th>
                  <th>Total</th>
                  <th>Editing</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <div className="kdc-order-source">
                        {order.imageUrl ? (
                          <img
                            className="kdc-order-thumbnail"
                            src={order.imageUrl}
                            alt=""
                          />
                        ) : (
                          <span className="kdc-order-thumbnail kdc-order-thumbnail--empty">
                            No image
                          </span>
                        )}
                        <Link
                          to={`/app/orders/order?id=${encodeURIComponent(order.id)}`}
                        >
                          <strong>{order.name}</strong>
                        </Link>
                      </div>
                    </td>
                    <td>
                      <div className="kdc-customer-cell">
                        <strong>{order.customerName ?? "No customer"}</strong>
                        <span>{order.email ?? "No email"}</span>
                      </div>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(order.createdAt))}
                    </td>
                    <td>
                      <FulfillmentStatus status={order.fulfillmentStatus} />
                    </td>
                    <td>
                      {money(order.total.amount, order.total.currencyCode)}
                    </td>
                    <td>
                      {order.cancelled
                        ? "Cancelled"
                        : order.editable
                          ? "Editable"
                          : "View only"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <s-empty-state heading="No matching Shopify orders">
            <s-button href="/app/orders">Clear search</s-button>
          </s-empty-state>
        )}

        <div className="kdc-pagination">
          {data.after ? (
            <s-button
              href={`/app/orders${data.search ? `?q=${encodeURIComponent(data.search)}` : ""}`}
            >
              First page
            </s-button>
          ) : (
            <span />
          )}
          {data.pageInfo.hasNextPage && data.pageInfo.endCursor ? (
            <s-button href={`/app/orders?${nextParams.toString()}`}>
              Next 50 orders
            </s-button>
          ) : null}
        </div>
      </s-section>
    </s-page>
  );
}
