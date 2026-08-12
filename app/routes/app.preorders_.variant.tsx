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
  ensureProductPreorderMetafieldDefinitions,
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
  const url = new URL(request.url);
  const shouldRefresh = url.searchParams.get("refresh") === "1";
  const variants = await listBulkPreorderVariants(admin, session.shop, {
    refresh: shouldRefresh,
    cacheOnly: !shouldRefresh,
  });
  await ensureProductPreorderMetafieldDefinitions(admin);
  const variant = variants.find(
    (item) => item.id === productId || item.variantIds.includes(productId),
  );
  if (!variant) {
    throw new Response("No Shopify orders contain this product.", {
      status: 404,
    });
  }
  return { variant, saved: url.searchParams.get("saved") };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productId = requiredProductId(request);
  const form = await request.formData();

  try {
    const variants = await listBulkPreorderVariants(admin, session.shop, {
      refresh: true,
    });
    const variant = variants.find(
      (item) => item.id === productId || item.variantIds.includes(productId),
    );
    if (!variant) {
      return Response.json(
        { error: "No Shopify orders contain this product." },
        { status: 404 },
      );
    }
    await ensureProductPreorderMetafieldDefinitions(admin);
    const updated = await updateBulkPreorderMessages(admin, variant.productId, {
      eta: String(form.get("preorderEta") ?? ""),
      pendingPrice: String(form.get("preorderPendingPrice") ?? ""),
      closing: String(form.get("preorderClosing") ?? ""),
    });
    invalidateBulkPreorderCache(session.shop);
    return redirect(
      `/app/preorders/variant?id=${encodeURIComponent(variant.id)}&saved=${updated}&refresh=1`,
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
          Updated this product as a preorder. Its existing unfulfilled customer
          orders can now appear in Pre-Orders.
        </s-banner>
      ) : null}
      {actionData?.error ? (
        <s-banner tone="critical">{actionData.error}</s-banner>
      ) : null}

      <s-section heading="Product preorder details">
        <s-banner tone="info">
          This adds the preorder tag and saves the ETA and pending price on the
          Shopify product. Existing order totals and line items are not changed.
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
                defaultValue={variant.preorderEta ?? ""}
              />
            </label>
            <label>
              Preorder Price (INR)
              <input
                className="kdc-text-input"
                type="number"
                min="0"
                step="0.01"
                name="preorderPendingPrice"
                placeholder="2000"
                defaultValue={variant.preorderPendingPrice ?? ""}
              />
            </label>
            <label>
              Preorder Closing
              <input
                className="kdc-text-input"
                name="preorderClosing"
                maxLength={120}
                placeholder="Jul 8, 2026"
                defaultValue={variant.preorderClosing ?? ""}
              />
            </label>
          </div>
          <p className="kdc-muted">
            Product ID: {numericProductId} · Variants:{" "}
            {variant.variantIds.length}
          </p>

          <div className="kdc-table-wrap">
            <table className="kdc-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {variant.orders.map((order) => (
                  <tr key={order.id}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="kdc-form-actions">
            <span className="kdc-muted">
              {variant.orderCount} existing matching order(s), newest first.
              Clear both fields to remove the product preorder data and tag.
            </span>
            <button
              className="kdc-native-button"
              type="submit"
              disabled={saving}
            >
              {saving ? "Updating product…" : "Update preorder product"}
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
