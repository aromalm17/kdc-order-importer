import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listBulkPreorderVariants } from "../services/shopify-order-manager.server";

function numericId(value: string) {
  return value.split("/").at(-1) ?? value;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const variants = await listBulkPreorderVariants(admin, session.shop, {
    refresh: url.searchParams.get("refresh") === "1",
  });
  const needle = search.toLowerCase();
  const filtered = needle
    ? variants.filter((variant) =>
        [
          variant.title,
          variant.productId,
          numericId(variant.productId),
          ...(variant.variantIds ?? []),
          variant.sku,
        ].some((value) => value?.toLowerCase().includes(needle)),
      )
    : variants;

  return {
    search,
    totalProducts: variants.length,
    variants: filtered.map((variant) => {
      const { orders, ...summary } = variant;
      return {
        ...summary,
        productNumericId: numericId(variant.productId),
        variantCount: variant.variantIds.length,
        latestOrderAt: orders[0]?.createdAt ?? null,
      };
    }),
  };
}

export default function BulkPreorders() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Bulk preorders">
      <s-button slot="primary-action" href="/app/preorders?refresh=1">
        Refresh products
      </s-button>

      <s-section>
        <div className="kdc-managed-toolbar">
          <div>
            <h2>Products across Shopify orders</h2>
            <p>
              Products are grouped by product name and sorted by matching order
              count, highest first. Orders inside each product are newest first.
            </p>
          </div>
          <Form method="get" className="kdc-managed-search">
            <label htmlFor="bulk-preorder-search">Product name or ID</label>
            <div>
              <input
                id="bulk-preorder-search"
                className="kdc-text-input"
                name="q"
                defaultValue={data.search}
                placeholder="Product name, ID, SKU, or variant ID"
              />
              <button className="kdc-native-button" type="submit">
                Filter
              </button>
              {data.search ? (
                <Link className="kdc-secondary-link" to="/app/preorders">
                  Clear
                </Link>
              ) : null}
            </div>
          </Form>
        </div>
      </s-section>

      <s-section
        heading={`${data.variants.length} of ${data.totalProducts} products`}
      >
        {data.variants.length ? (
          <div className="kdc-table-wrap">
            <table className="kdc-table kdc-bulk-preorder-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Product ID</th>
                  <th>Variants</th>
                  <th>Orders</th>
                  <th>Quantity</th>
                  <th>Latest order</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((variant) => (
                  <tr key={variant.id}>
                    <td>
                      <div className="kdc-order-source">
                        {variant.imageUrl ? (
                          <img
                            className="kdc-order-thumbnail"
                            src={variant.imageUrl}
                            alt=""
                          />
                        ) : (
                          <span className="kdc-order-thumbnail kdc-order-thumbnail--empty">
                            No image
                          </span>
                        )}
                        <Link
                          to={`/app/preorders/variant?id=${encodeURIComponent(variant.productId)}`}
                        >
                          <strong>{variant.title}</strong>
                        </Link>
                      </div>
                    </td>
                    <td>{variant.productNumericId}</td>
                    <td>{variant.variantCount}</td>
                    <td>
                      <strong>{variant.orderCount}</strong>
                    </td>
                    <td>{variant.totalQuantity}</td>
                    <td>
                      {variant.latestOrderAt
                        ? new Intl.DateTimeFormat("en-IN", {
                            dateStyle: "medium",
                          }).format(new Date(variant.latestOrderAt))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <s-empty-state heading="No matching ordered products">
            <s-button href="/app/preorders">Clear filter</s-button>
          </s-empty-state>
        )}
      </s-section>
    </s-page>
  );
}
