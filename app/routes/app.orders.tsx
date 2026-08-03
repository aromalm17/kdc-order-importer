import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  listManagedOrders,
  permanentlyDeleteManagedOrders,
} from "../services/shopify-order-manager.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const after = url.searchParams.get("after");
  const deleted = url.searchParams.get("deleted");
  const deletedCount = url.searchParams.get("deletedCount");
  const result = await listManagedOrders(admin, {
    after,
    query: search,
    first: 50,
  });
  return {
    ...result,
    search,
    after,
    deleted,
    deletedCount: deletedCount ? Number(deletedCount) : null,
  };
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = formText(form, "intent");

  try {
    if (intent === "delete-selected-orders") {
      const orderIds = form
        .getAll("orderIds")
        .map((value) => String(value).trim())
        .filter(Boolean);
      if (!orderIds.length) {
        return Response.json(
          { error: "Select at least one order to delete.", intent },
          { status: 400 },
        );
      }
      const deletedNames = await permanentlyDeleteManagedOrders(admin, orderIds);
      if (!deletedNames.length) {
        return Response.json(
          { error: "No selected orders could be deleted.", intent },
          { status: 400 },
        );
      }
      return redirect(
        `/app/orders?deletedCount=${encodeURIComponent(String(deletedNames.length))}`,
      );
    }

    return Response.json(
      { error: "Unknown order action.", intent },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Shopify could not complete this order change.",
        intent,
      },
      { status: 400 },
    );
  }
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
  const actionData = useActionData<typeof action>() as
    | { error?: string; intent?: string }
    | undefined;
  const navigation = useNavigation();
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const selectedOrderIdSet = useMemo(
    () => new Set(selectedOrderIds),
    [selectedOrderIds],
  );
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const allSelected =
    data.orders.length > 0 && selectedOrderIds.length === data.orders.length;
  const someSelected =
    selectedOrderIds.length > 0 && selectedOrderIds.length < data.orders.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleOrder(orderId: string, checked: boolean) {
    setSelectedOrderIds((current) => {
      if (checked) {
        return current.includes(orderId) ? current : [...current, orderId];
      }
      return current.filter((value) => value !== orderId);
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedOrderIds(checked ? data.orders.map((order) => order.id) : []);
  }

  const nextParams = new URLSearchParams();
  if (data.search) nextParams.set("q", data.search);
  if (data.pageInfo.endCursor) {
    nextParams.set("after", data.pageInfo.endCursor);
  }
  const deleting =
    navigation.state === "submitting" &&
    String(navigation.formData?.get("intent")) === "delete-selected-orders";

  return (
    <s-page heading="Shopify orders">
      <s-button slot="primary-action" href="/app/orders">
        Refresh orders
      </s-button>
      <s-section>
        {data.deletedCount ? (
          <s-banner tone="success">
            {data.deletedCount === 1
              ? "1 order was permanently deleted from Shopify."
              : `${data.deletedCount} orders were permanently deleted from Shopify.`}
          </s-banner>
        ) : null}
        {data.deleted ? (
          <s-banner tone="success">
            {data.deleted} was permanently deleted from Shopify.
          </s-banner>
        ) : null}
        {actionData?.error ? <s-banner tone="critical">{actionData.error}</s-banner> : null}
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
        <Form
          method="post"
          className="kdc-managed-delete-toolbar"
          onSubmit={(event) => {
            if (!selectedOrderIds.length) {
              event.preventDefault();
              return;
            }
            if (
              !window.confirm(
                `Delete ${selectedOrderIds.length} selected orders from Shopify? This cannot be undone.`,
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete-selected-orders" />
          {selectedOrderIds.map((orderId) => (
            <input key={orderId} type="hidden" name="orderIds" value={orderId} />
          ))}
          <div className="kdc-managed-delete-summary" aria-live="polite">
            {selectedOrderIds.length
              ? `${selectedOrderIds.length} selected`
              : "Select orders to enable bulk delete"}
          </div>
          <button
            className="kdc-danger-button"
            type="submit"
            disabled={!selectedOrderIds.length || deleting}
          >
            Delete all selected
          </button>
        </Form>
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
                  <th className="kdc-select-cell">
                    <label className="kdc-selection-control">
                      <input
                        ref={selectAllRef}
                        className="kdc-order-checkbox"
                        type="checkbox"
                        checked={allSelected}
                        disabled={navigation.state === "submitting"}
                        aria-label="Select all orders on this page"
                        onChange={(event) =>
                          toggleAll(event.currentTarget.checked)
                        }
                      />
                    </label>
                  </th>
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
                  <tr
                    key={order.id}
                    className={
                      selectedOrderIdSet.has(order.id)
                        ? "kdc-table-row--selected"
                        : undefined
                    }
                  >
                    <td className="kdc-select-cell">
                      <label className="kdc-selection-control">
                        <input
                          className="kdc-order-checkbox"
                          type="checkbox"
                          checked={selectedOrderIdSet.has(order.id)}
                          disabled={navigation.state === "submitting"}
                          aria-label={`Select ${order.name}`}
                          onChange={(event) =>
                            toggleOrder(order.id, event.currentTarget.checked)
                          }
                        />
                      </label>
                    </td>
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
