import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureProductPreorderMetafieldDefinitions,
  listBulkPreorderVariants,
} from "../services/shopify-order-manager.server";

function numericId(value: string) {
  return value.split("/").at(-1) ?? value;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const requestedStatus = url.searchParams.get("status");
  const status =
    requestedStatus === "configured" || requestedStatus === "all"
      ? requestedStatus
      : "needs-setup";
  const shouldRefresh = url.searchParams.get("refresh") === "1";
  const variants = await listBulkPreorderVariants(admin, session.shop, {
    refresh: shouldRefresh,
    cacheOnly: !shouldRefresh,
  });
  if (shouldRefresh) {
    await ensureProductPreorderMetafieldDefinitions(admin);
  }
  const needle = search.toLowerCase();
  const productIsConfigured = (variant: (typeof variants)[number]) =>
    variant.isTaggedPreorder &&
    Boolean(variant.preorderEta?.trim()) &&
    Boolean(variant.preorderPendingPrice?.trim());
  const configuredProducts = variants.filter(productIsConfigured).length;
  const filtered = variants.filter((variant) => {
    const configured = productIsConfigured(variant);
    const matchesStatus =
      status === "all" || (status === "configured" ? configured : !configured);
    const matchesSearch =
      !needle ||
      [
        variant.title,
        variant.productId,
        numericId(variant.productId),
        ...(variant.variantIds ?? []),
        variant.sku,
      ].some((value) => value?.toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });

  const refreshParams = new URLSearchParams({ status, refresh: "1" });
  if (search) refreshParams.set("q", search);
  const clearParams = new URLSearchParams({ status });
  const tabHref = (nextStatus: "needs-setup" | "configured" | "all") => {
    const params = new URLSearchParams({ status: nextStatus });
    if (search) params.set("q", search);
    return `/app/preorders?${params.toString()}`;
  };

  return {
    search,
    status,
    totalProducts: variants.length,
    configuredProducts,
    needsSetupProducts: variants.length - configuredProducts,
    refreshHref: `/app/preorders?${refreshParams.toString()}`,
    clearHref: `/app/preorders?${clearParams.toString()}`,
    tabs: [
      {
        status: "needs-setup",
        label: "Needs setup",
        count: variants.length - configuredProducts,
        href: tabHref("needs-setup"),
      },
      {
        status: "configured",
        label: "Configured",
        count: configuredProducts,
        href: tabHref("configured"),
      },
      {
        status: "all",
        label: "All",
        count: variants.length,
        href: tabHref("all"),
      },
    ],
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

  function clearBrowserStorageAndRefresh() {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.assign(data.refreshHref);
    }
  }

  return (
    <s-page heading="Bulk preorders">
      <s-button
        slot="primary-action"
        onClick={clearBrowserStorageAndRefresh}
      >
        Clear browser data and fetch from database
      </s-button>

      <s-section>
        <div className="kdc-managed-toolbar">
          <div>
            <h2>Products across Shopify orders</h2>
            <p>
              Products with preorder tag, price, and ETA are hidden from Needs
              setup and listed under Configured. Page load uses saved app data;
              click the fetch button when you want a fresh Shopify database sync.
            </p>
          </div>
          <Form method="get" className="kdc-managed-search">
            <input type="hidden" name="status" value={data.status} />
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
                <Link className="kdc-secondary-link" to={data.clearHref}>
                  Clear
                </Link>
              ) : null}
            </div>
          </Form>
        </div>
      </s-section>

      <div className="kdc-preorder-tabs" role="tablist" aria-label="Preorder status">
        {data.tabs.map((tab) => (
          <Link
            key={tab.status}
            className={
              tab.status === data.status
                ? "kdc-preorder-tab kdc-preorder-tab--active"
                : "kdc-preorder-tab"
            }
            role="tab"
            aria-selected={tab.status === data.status}
            to={tab.href}
          >
            <span>{tab.label}</span>
            <span className="kdc-preorder-tab__count">{tab.count}</span>
          </Link>
        ))}
      </div>

      <s-section heading={`${data.variants.length} matching products`}>
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
                  <th>Status</th>
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
                      {variant.isTaggedPreorder &&
                      variant.preorderEta &&
                      variant.preorderPendingPrice
                        ? "Configured"
                        : "Needs setup"}
                    </td>
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
            <s-button href="/app/preorders?status=needs-setup">
              Show products needing setup
            </s-button>
          </s-empty-state>
        )}
      </s-section>
    </s-page>
  );
}
