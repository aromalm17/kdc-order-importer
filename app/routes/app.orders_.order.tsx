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
  editManagedOrderLine,
  getManagedOrder,
  permanentlyDeleteManagedOrder,
  replaceManagedShippingCharge,
  searchManagedVariants,
  updateManagedOrderContact,
} from "../services/shopify-order-manager.server";

function requiredOrderId(request: Request) {
  const orderId = new URL(request.url).searchParams.get("id")?.trim();
  if (!orderId?.startsWith("gid://shopify/Order/")) {
    throw new Response("A valid Shopify order ID is required.", {
      status: 400,
    });
  }
  return orderId;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const orderId = requiredOrderId(request);
  const variantSearch = url.searchParams.get("variantSearch")?.trim() ?? "";
  const [order, variants] = await Promise.all([
    getManagedOrder(admin, orderId),
    variantSearch
      ? searchManagedVariants(admin, variantSearch)
      : Promise.resolve([]),
  ]);
  if (!order) throw new Response("Shopify order not found.", { status: 404 });
  return {
    order,
    variantSearch,
    variants,
    saved: url.searchParams.get("saved"),
  };
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}

function redirectToOrder(orderId: string, saved: string) {
  return redirect(
    `/app/orders/order?id=${encodeURIComponent(orderId)}&saved=${encodeURIComponent(saved)}`,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const orderId = requiredOrderId(request);
  const form = await request.formData();
  const intent = formText(form, "intent");

  try {
    if (intent === "update-contact") {
      await updateManagedOrderContact(admin, orderId, {
        email: formText(form, "email"),
        phone: formText(form, "phone"),
        note: formText(form, "note"),
        shippingAddress: {
          firstName: formText(form, "firstName"),
          lastName: formText(form, "lastName"),
          company: formText(form, "company"),
          address1: formText(form, "address1"),
          address2: formText(form, "address2"),
          city: formText(form, "city"),
          provinceCode: formText(form, "provinceCode"),
          zip: formText(form, "zip"),
          countryCodeV2: formText(form, "countryCode"),
          phone: formText(form, "shippingPhone"),
        },
      });
      return redirectToOrder(orderId, "Address and contact details updated");
    }

    if (intent === "update-shipping") {
      const order = await getManagedOrder(admin, orderId);
      if (!order) {
        return Response.json(
          { error: "The order no longer exists.", intent },
          { status: 404 },
        );
      }
      await replaceManagedShippingCharge(admin, {
        orderId,
        title: formText(form, "shippingTitle"),
        amount: formText(form, "shippingAmount"),
        currencyCode: order.total.currencyCode,
      });
      return redirectToOrder(orderId, "Shipping charge updated");
    }

    if (intent === "update-line") {
      await editManagedOrderLine(admin, {
        orderId,
        lineItemId: formText(form, "lineItemId"),
        quantity: Number(formText(form, "quantity")),
        replacementVariantId: formText(form, "replacementVariantId"),
        expectedImageUrl: formText(form, "expectedImageUrl"),
        restock: form.get("restock") === "on",
      });
      return redirectToOrder(orderId, "Order product updated");
    }

    if (intent === "delete-order") {
      const order = await getManagedOrder(admin, orderId);
      if (!order) {
        return Response.json(
          { error: "The order no longer exists.", intent },
          { status: 404 },
        );
      }
      await permanentlyDeleteManagedOrder(admin, {
        orderId,
        expectedOrderName: order.name,
        confirmation: formText(form, "confirmation"),
      });
      return redirect(`/app/orders?deleted=${encodeURIComponent(order.name)}`);
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

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function addressLines(
  address:
    | {
        firstName?: string | null;
        lastName?: string | null;
        company?: string | null;
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        province?: string | null;
        zip?: string | null;
        country?: string | null;
        phone?: string | null;
      }
    | null
    | undefined,
) {
  if (!address) return ["Not set"];
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  return [
    name,
    address.company,
    address.address1,
    address.address2,
    [address.city, address.province, address.zip].filter(Boolean).join(", "),
    address.country,
    address.phone,
  ].filter((value): value is string => Boolean(value));
}

export default function ManagedOrderDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as
    { error?: string; intent?: string } | undefined;
  const navigation = useNavigation();
  const submitting =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("intent") ?? "")
      : null;
  const order = data.order;
  const address = order.shippingAddress;
  const currencyCode = order.total.currencyCode;
  const defaultShippingTitle =
    order.shippingLines.map((line) => line.title).join(" + ") || "Shipping";
  const expectedDeleteText = `DELETE ${order.name}`;

  return (
    <s-page heading={`Edit ${order.name}`}>
      <s-button slot="primary-action" href="/app/orders">
        Back to Shopify orders
      </s-button>

      {data.saved ? <s-banner tone="success">{data.saved}.</s-banner> : null}
      {actionData?.error ? (
        <s-banner tone="critical">{actionData.error}</s-banner>
      ) : null}
      {!order.merchantEditable ? (
        <s-banner tone="warning">
          Shopify marks this order as view-only
          {order.merchantEditableErrors.length
            ? `: ${order.merchantEditableErrors.join("; ")}`
            : "."}
          Address updates or deletion can still be attempted when Shopify
          permits them, but product and shipping-charge edits may be rejected.
        </s-banner>
      ) : null}

      <s-section heading="Order summary">
        <div className="kdc-order-detail-grid">
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Customer</span>
            <strong>{order.customer?.displayName ?? "No customer"}</strong>
            <div className="kdc-muted">{order.email ?? "No email"}</div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Created</span>
            <strong>{dateTime(order.createdAt)}</strong>
            <div className="kdc-muted">Updated {dateTime(order.updatedAt)}</div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Status</span>
            <strong>{order.displayFinancialStatus}</strong>
            <div className="kdc-muted">
              {order.displayFulfillmentStatus}
              {order.cancelledAt ? " · Cancelled" : ""}
            </div>
          </div>
          <div className="kdc-order-detail-field">
            <span className="kdc-order-detail-label">Total</span>
            <strong>{money(order.total.amount, currencyCode)}</strong>
            <div className="kdc-muted">
              Outstanding {money(order.outstanding.amount, currencyCode)}
            </div>
          </div>
        </div>
      </s-section>

      <s-section heading="Shipping address and contact">
        <Form method="post" className="kdc-managed-form">
          <input type="hidden" name="intent" value="update-contact" />
          <div className="kdc-form-grid">
            <label>
              Email
              <input
                className="kdc-text-input"
                type="email"
                name="email"
                defaultValue={order.email ?? ""}
              />
            </label>
            <label>
              Order phone
              <input
                className="kdc-text-input"
                name="phone"
                defaultValue={order.phone ?? order.customer?.phone ?? ""}
              />
            </label>
            <label>
              First name
              <input
                className="kdc-text-input"
                name="firstName"
                defaultValue={address?.firstName ?? ""}
              />
            </label>
            <label>
              Last name
              <input
                className="kdc-text-input"
                name="lastName"
                defaultValue={address?.lastName ?? ""}
              />
            </label>
            <label>
              Company
              <input
                className="kdc-text-input"
                name="company"
                defaultValue={address?.company ?? ""}
              />
            </label>
            <label>
              Shipping phone
              <input
                className="kdc-text-input"
                name="shippingPhone"
                defaultValue={address?.phone ?? ""}
              />
            </label>
            <label className="kdc-form-span-2">
              Address line 1
              <input
                className="kdc-text-input"
                name="address1"
                defaultValue={address?.address1 ?? ""}
              />
            </label>
            <label className="kdc-form-span-2">
              Address line 2
              <input
                className="kdc-text-input"
                name="address2"
                defaultValue={address?.address2 ?? ""}
              />
            </label>
            <label>
              City
              <input
                className="kdc-text-input"
                name="city"
                defaultValue={address?.city ?? ""}
              />
            </label>
            <label>
              State / province code
              <input
                className="kdc-text-input"
                name="provinceCode"
                defaultValue={address?.provinceCode ?? ""}
                placeholder="KL"
              />
            </label>
            <label>
              PIN / postal code
              <input
                className="kdc-text-input"
                name="zip"
                defaultValue={address?.zip ?? ""}
              />
            </label>
            <label>
              Country code
              <input
                className="kdc-text-input"
                name="countryCode"
                defaultValue={address?.countryCodeV2 ?? "IN"}
                maxLength={2}
                placeholder="IN"
              />
            </label>
            <label className="kdc-form-span-2">
              Order note
              <textarea
                className="kdc-textarea"
                name="note"
                defaultValue={order.note ?? ""}
                rows={3}
              />
            </label>
          </div>
          <div className="kdc-form-actions">
            <button
              className="kdc-native-button"
              type="submit"
              disabled={Boolean(submitting)}
            >
              {submitting === "update-contact"
                ? "Saving…"
                : "Save address and contact"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Shipping charge">
        <s-banner tone="warning">
          Saving replaces all existing shipping lines with one custom charge.
          Enter 0 to remove shipping charges. Shopify may create an amount due
          or refund balance when the order total changes.
        </s-banner>
        <Form method="post" className="kdc-managed-inline-form">
          <input type="hidden" name="intent" value="update-shipping" />
          <label>
            Shipping title
            <input
              className="kdc-text-input"
              name="shippingTitle"
              defaultValue={defaultShippingTitle}
            />
          </label>
          <label>
            Amount ({currencyCode})
            <input
              className="kdc-text-input"
              type="number"
              min="0"
              step="0.01"
              name="shippingAmount"
              defaultValue={order.shippingTotal.amount}
              required
            />
          </label>
          <button
            className="kdc-native-button"
            type="submit"
            disabled={Boolean(submitting)}
          >
            {submitting === "update-shipping"
              ? "Updating…"
              : "Replace shipping charge"}
          </button>
        </Form>
      </s-section>

      <s-section heading="Products and variants">
        <Form method="get" className="kdc-managed-variant-search">
          <input type="hidden" name="id" value={order.id} />
          <label htmlFor="variant-search">
            Find a replacement product by title, SKU, or variant ID
          </label>
          <div>
            <input
              id="variant-search"
              className="kdc-text-input"
              name="variantSearch"
              defaultValue={data.variantSearch}
              placeholder="Search products or paste variant ID"
            />
            <button className="kdc-native-button" type="submit">
              Find variants
            </button>
          </div>
        </Form>

        {data.variantSearch ? (
          <div className="kdc-variant-results">
            <strong>{data.variants.length} replacement variants found</strong>
            {data.variants.length ? (
              <div className="kdc-variant-result-grid">
                {data.variants.map((variant) => (
                  <div className="kdc-variant-result" key={variant.id}>
                    {variant.imageUrl ? (
                      <img src={variant.imageUrl} alt="" />
                    ) : (
                      <span className="kdc-order-thumbnail--empty">
                        No image
                      </span>
                    )}
                    <div>
                      <strong>{variant.product.title}</strong>
                      <span>
                        {variant.title} · SKU {variant.sku || "—"} ·{" "}
                        {money(variant.price, currencyCode)}
                      </span>
                      <code>{variant.id}</code>
                      {variant.imageUrl ? (
                        <code>{variant.imageUrl}</code>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                No variants matched. Try an exact SKU or numeric variant ID.
              </p>
            )}
          </div>
        ) : null}

        <s-banner tone="info">
          Shopify controls an order item&apos;s image through its assigned
          variant. Entering a replacement variant changes the product and image
          together. The optional image link below verifies that the expected
          Shopify CDN image belongs to that variant.
        </s-banner>

        <div className="kdc-managed-line-list">
          {order.lineItems.map((line) => (
            <Form method="post" className="kdc-managed-line-card" key={line.id}>
              <input type="hidden" name="intent" value="update-line" />
              <input type="hidden" name="lineItemId" value={line.id} />
              <div className="kdc-managed-line-current">
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
                <div>
                  <strong>{line.title}</strong>
                  <span>
                    {line.variantTitle || "Default"} · SKU {line.sku || "—"}
                  </span>
                  <span>
                    Current variant:{" "}
                    {line.variant?.id.replace(
                      "gid://shopify/ProductVariant/",
                      "",
                    ) ?? "Custom item"}
                  </span>
                  <span>
                    Unit price {money(line.unitPrice.amount, currencyCode)} ·
                    Fulfillable {line.fulfillableQuantity}
                  </span>
                  {line.imageUrl ? <code>{line.imageUrl}</code> : null}
                </div>
              </div>
              <div className="kdc-form-grid kdc-line-edit-grid">
                <label>
                  Quantity
                  <input
                    className="kdc-text-input"
                    type="number"
                    min="0"
                    step="1"
                    name="quantity"
                    defaultValue={line.currentQuantity}
                    required
                  />
                  <small>Set to 0 to remove this unfulfilled line.</small>
                </label>
                <label>
                  Replacement variant ID
                  <input
                    className="kdc-text-input"
                    name="replacementVariantId"
                    list="kdc-variant-ids"
                    placeholder="Optional numeric or gid:// ID"
                  />
                  <small>Leave blank to change quantity only.</small>
                </label>
                <label className="kdc-form-span-2">
                  Expected replacement image link
                  <input
                    className="kdc-text-input"
                    type="url"
                    name="expectedImageUrl"
                    placeholder="Optional https://cdn.shopify.com/s/files/..."
                  />
                </label>
              </div>
              <label className="kdc-checkbox-label">
                <input type="checkbox" name="restock" />
                Restock removed quantity when Shopify permits it
              </label>
              <button
                className="kdc-native-button"
                type="submit"
                disabled={Boolean(submitting)}
              >
                {submitting === "update-line"
                  ? "Updating product…"
                  : "Update this product"}
              </button>
            </Form>
          ))}
        </div>
        <datalist id="kdc-variant-ids">
          {data.variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.product.title} — {variant.title} —{" "}
              {variant.sku || "No SKU"}
            </option>
          ))}
        </datalist>
      </s-section>

      <s-section heading="Address reference">
        <div className="kdc-address-grid">
          <div className="kdc-address-card">
            <strong>Current shipping address</strong>
            <p>{addressLines(order.shippingAddress).join("\n")}</p>
          </div>
          <div className="kdc-address-card">
            <strong>Billing address (read-only)</strong>
            <p>{addressLines(order.billingAddress).join("\n")}</p>
          </div>
        </div>
      </s-section>

      <s-section heading="Permanent deletion">
        <div className="kdc-danger-zone">
          <div>
            <h3>Delete {order.name} completely</h3>
            <p>
              This is irreversible. Shopify only allows deletion for eligible
              order types, and your staff account must have the delete-orders
              permission. Other orders must be cancelled in Shopify instead.
            </p>
          </div>
          <Form method="post" className="kdc-delete-form">
            <input type="hidden" name="intent" value="delete-order" />
            <label htmlFor="delete-confirmation">
              Type <strong>{expectedDeleteText}</strong>
            </label>
            <input
              id="delete-confirmation"
              className="kdc-text-input"
              name="confirmation"
              autoComplete="off"
              required
            />
            <button
              className="kdc-danger-button"
              type="submit"
              disabled={Boolean(submitting)}
            >
              {submitting === "delete-order"
                ? "Deleting permanently…"
                : "Delete order permanently"}
            </button>
          </Form>
        </div>
      </s-section>

      <p className="kdc-back-link">
        <Link to="/app/orders">← Back to all Shopify orders</Link>
      </p>
    </s-page>
  );
}
