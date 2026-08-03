import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { authenticate } from "../shopify.server";
import {
  invalidateBulkPreorderCache,
  listBulkPreorderVariants,
  updateBulkPreorderMessages,
} from "../services/shopify-order-manager.server";

function requiredProductId(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (
    !id?.startsWith("gid://shopify/Product/") &&
    !id?.startsWith("gid://shopify/ProductVariant/")
  ) {
    throw new Response("A valid Shopify Product ID is required.", {
      status: 400,
    });
  }
  return id;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productId = requiredProductId(request);
  const variants = await listBulkPreorderVariants(admin, session.shop);
  const variant = variants.find(
    (item) => item.id === productId || item.variantIds.includes(productId),
  );
  if (!variant) {
    throw new Response("No Shopify orders contain this product.", {
      status: 404,
    });
  }
  const url = new URL(request.url);
  return { variant, saved: url.searchParams.get("saved") };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productId = requiredProductId(request);
  const form = await request.formData();

  try {
    const variants = await listBulkPreorderVariants(admin, session.shop);
    const variant = variants.find(
      (item) => item.id === productId || item.variantIds.includes(productId),
    );
    if (!variant) {
      return Response.json(
        { error: "No Shopify orders contain this product." },
        { status: 404 },
      );
    }
    const allowedIds = new Set(variant.orders.map((order) => order.id));
    const selectedOrderIds = form
      .getAll("selectedOrderId")
      .map(String)
      .filter((id) => allowedIds.has(id));
    const updated = await updateBulkPreorderMessages(admin, selectedOrderIds, {
      eta: String(form.get("preorderEta") ?? ""),
      pendingPrice: String(form.get("preorderPendingPrice") ?? ""),
    });
    invalidateBulkPreorderCache(session.shop);
    return redirect(
      `/app/preorders/variant?id=${encodeURIComponent(variant.id)}&saved=${updated}`,
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bulk update failed." },
      { status: 400 },
    );
  }
}

export default function BulkPreorderVariant() {
  const { variant, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const numericProductId = variant.productId.split("/").at(-1);

  return (
    <s-page heading={variant.title}>
      <s-button slot="secondary-actions" href="/app/preorders">
        Back to bulk preorders
      </s-button>

      {saved ? (
        <s-banner tone="success">
          Updated preorder details on {saved} selected order(s).
        </s-banner>
      ) : null}
      {actionData?.error ? (
        <s-banner tone="critical">{actionData.error}</s-banner>
      ) : null}

      <s-section heading="Bulk preorder customer message">
        <s-banner tone="info">
          This writes the same ETA and pending price to every selected order
          containing this exact product. Product data and order totals are not
          changed.
        </s-banner>
        <Form method="post" className="kdc-managed-form">
          <div className="kdc-form-grid">
            <label>
              Arrival ETA
              <input
                className="kdc-text-input"
                name="preorderEta"
                maxLength={120}
                placeholder="first week of August"
              />
            </label>
            <label>
              Pending price (INR)
              <input
                className="kdc-text-input"
                type="number"
                min="0"
                step="0.01"
                name="preorderPendingPrice"
                placeholder="2000"
              />
            </label>
          </div>
          <p className="kdc-muted">
            Product ID: {numericProductId} · Variants: {variant.variantIds.length}
          </p>

          <div className="kdc-table-wrap">
            <table className="kdc-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all matching orders"
                      defaultChecked
                      onChange={(event) => {
                        const form = event.currentTarget.closest("form");
                        form
                          ?.querySelectorAll<HTMLInputElement>(
                            'input[name="selectedOrderId"]',
                          )
                          .forEach((checkbox) => {
                            checkbox.checked = event.currentTarget.checked;
                          });
                      }}
                    />
                  </th>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Qty</th>
                  <th>Current ETA</th>
                  <th>Current pending price</th>
                </tr>
              </thead>
              <tbody>
                {variant.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <input
                        type="checkbox"
                        name="selectedOrderId"
                        value={order.id}
                        aria-label={`Select ${order.name}`}
                        defaultChecked
                      />
                    </td>
                    <td>
                      <Link
                        to={`/app/orders/order?id=${encodeURIComponent(order.id)}`}
                      >
                        <strong>{order.name}</strong>
                      </Link>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(order.createdAt))}
                    </td>
                    <td>
                      <strong>{order.customerName ?? "No customer"}</strong>
                      <div className="kdc-muted">{order.email ?? "—"}</div>
                    </td>
                    <td>{order.quantity}</td>
                    <td>{order.preorderEta ?? "—"}</td>
                    <td>{order.preorderPendingPrice ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="kdc-form-actions">
            <span className="kdc-muted">
              {variant.orderCount} matching order(s), newest first. Clear both
              fields to remove the message from selected orders.
            </span>
            <button
              className="kdc-native-button"
              type="submit"
              disabled={saving}
            >
              {saving ? "Updating selected orders…" : "Update selected orders"}
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
