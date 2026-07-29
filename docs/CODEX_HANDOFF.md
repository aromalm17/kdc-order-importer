# Codex handoff: KDC Order Importer

Last refreshed: 2026-07-30

## Project identity

- Project directory: `kdc-order-importer/`
- Git repository: this directory, on branch `main`
- Deployment remote: `deploy` points to
  `https://github.com/aromalm17/kdc-order-importer.git`
- Shopify store: `keraladiecastcars.myshopify.com`
- Render service name in `render.yaml`: `kdc-order-importer-web`
- Stack: Shopify embedded custom app, React Router, TypeScript, Shopify App
  Bridge/Polaris web components, ExcelJS/read-excel-file, Vitest
- Shopify Admin GraphQL API configured for `2026-07`

Do not treat the workspace directory above this project as a Git repository.
Do not copy files from old `/private/tmp/kdc-order-importer-deploy.*`
directories into the source tree.

## Current product behavior

The app imports historical orders from an Excel workbook. Uploaded workbooks
and pending jobs are intentionally held in memory only. Pending jobs have a
24-hour inactivity TTL and are also lost on a process restart or redeploy.
Successfully imported orders are removed from the pending list immediately.

The pending-orders screen currently provides:

- A checkbox for each ready order and a select-all-ready checkbox.
- An import action inside the top status card.
- A confirmation dialog that displays selected-ready, image-error, and total
  pending counts.
- A requirement to type `YES` before the import button is enabled.
- A `Download pending Excel` action in both the status card and confirmation
  dialog.
- Shopify-compatible client navigation from an order number to its detail
  page.

Customer profile lookups for the pending list and detail page are batched and
cached on the in-memory import job. Moving between the pending list and an
order-detail page should reuse that cache instead of querying Shopify again for
the same email. Preserve this behavior when changing either loader.

The single pending-order detail route is
`app/routes/app.preview_.order.tsx`, served at
`/app/preview/order?job=...&order=...`. It shows:

- Customer name, email, and phone.
- Order date, calculated workbook total, ready/blocked state, payment status,
  and fulfillment status.
- Shipping and billing addresses.
- A Shopify customer-profile fallback for missing customer name, phone, and
  shipping address.
- Every line item with image, product/variant, SKU, variant ID, quantity, unit
  price, line total, and validation issues.
- Back navigation to the same pending job.

The route name is deliberately `app.preview_.order.tsx`: the trailing
underscore creates `/app/preview/order` as a sibling URL while keeping it out
of the preview route's nested layout. Do not rename it back to
`app.preview.order.tsx` without checking React Router filesystem-route
semantics and embedded Shopify navigation.

## Shopify order management

The app navigation includes a `Shopify Orders` menu at `/app/orders`. This is
separate from the temporary pending-import list and loads orders directly from
Shopify. It provides:

- Fifty orders per page with cursor pagination and Shopify order search.
- Order totals, customer, fulfillment, cancellation, and editability status.
  The list intentionally omits the Payment column. Fulfillment is displayed as
  a compact color-coded badge: green fulfilled, amber partial/pending, red
  unfulfilled, blue scheduled/in progress, and gray fallback.
- A detail/editor route at `/app/orders/order?id=...`.
- Shipping-address, order email, phone, note, and shipping-phone updates using
  `orderUpdate`.
- Shipping-charge replacement through a Shopify order-edit session. It removes
  the existing shipping lines, optionally adds one custom shipping charge, and
  commits without emailing the customer. An amount of zero removes shipping.
- Quantity changes and line removal (quantity zero) for editable unfulfilled
  lines.
- Product/variant replacement by adding the selected Shopify variant, reducing
  the old calculated line to zero, and committing without emailing the
  customer.
- Product-variant search by title, SKU, or variant ID.
- Optional exact Shopify CDN image verification before replacing a variant.
  Shopify does not allow an order line's image URL to be edited independently;
  the assigned variant controls the image.
- Permanent deletion through `orderDelete`, guarded by requiring the exact text
  `DELETE <order name>`.

Order editing is subject to Shopify restrictions. In particular, only
unfulfilled editable lines can be changed; archived, cancelled, fulfilled,
pre-2019, international-currency, subscription, or otherwise restricted orders
can be view-only. Permanent deletion works only for Shopify-supported order
types and requires the authenticated staff user to have the `delete_orders`
permission. Unsupported deletion attempts return Shopify's error and must not
be converted into an automatic cancellation.

The order-management GraphQL documents were validated against Shopify Admin
GraphQL API `2026-07`. The app already has the required `read_orders`,
`read_all_orders`, `write_orders`, `read_products`, and `write_order_edits`
scopes.

This feature was deployed successfully on 2026-07-30:

- Source commit: local `93c940d`; deployment-snapshot commit `8f17895`
- Render deploy: `dep-d9l4qrdbedkc73brsu70`
- Validation: 54 tests, typecheck, lint, production build, and Shopify
  `2026-07` GraphQL code generation passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200. An unauthenticated `/app/orders` request returns Shopify's expected 410
  because embedded app authentication is required.
- No production order was edited or deleted during verification.

The simplified Shopify Orders status table was deployed on 2026-07-30:

- Source commit: local `079891b`; deployment-snapshot commit `8c12809`
- Render deploy: `dep-d9l663jl550s73fldkqg`
- Validation: 61 tests, typecheck, lint, production build, formatting,
  Shopify Admin GraphQL `2026-07` code generation, and `git diff --check`
  passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

## Import and validation rules

- A workbook line image is valid only when its URL is HTTPS, the host is
  exactly `cdn.shopify.com`, and its path begins with `/s/files/`.
- The user-facing required format is
  `https://cdn.shopify.com/s/files/`.
- Image comparison uses the canonical host and path, ignoring query strings
  and fragments. The workbook image must match an image assigned to the exact
  Shopify variant.
- Missing, invalid, unassigned, processing, or mismatched images block the
  whole order.
- Missing/invalid variant IDs and variants that do not exist in Shopify block
  the whole order.
- Only orders normalized as completed/fulfilled may import. Incomplete
  fulfillment statuses must remain blocked, and the server rechecks this
  before calling `orderCreate`.
- The expected Excel column heading is exactly `Fulfillment Status`
  (`Fulfilment Status` is also recognized as an alias).
- A blank or missing fulfillment status is normalized to `Fulfilled`.
  `Fulfilled` (including the existing `Fulfiled` spelling tolerance) is ready;
  `Unfulfilled`, partial, pending, open, on-hold, scheduled, and unknown
  nonblank statuses block the entire order.
- Fulfillment status is checked across every item row belonging to an order. If
  any row contains an incomplete nonblank value, the order is blocked.
- The pending Excel export includes the `Fulfillment Status` column.
- Imports use verified Shopify variant IDs; do not create custom/free-text
  items.
- Before import, the app matches the workbook customer email to the Shopify
  customer profile, loads the customer's structured default address, and sends
  it explicitly as the created order's `shippingAddress`. This lookup uses the
  job-scoped profile cache and also runs from the import path if the preview
  loader did not populate the cache first.
- The structured address includes first name, last name, company, address
  lines, city, province code, postal code, country code, and phone when those
  values exist on the Shopify customer. If no matching customer or default
  address is available, the import proceeds without an explicit shipping
  address rather than inventing address data.
- Historical customer and fulfillment email notifications remain disabled.
- Before importing, variants and their images are verified again against
  Shopify to prevent stale preview data from bypassing validation.
- Every newly imported Shopify order receives exactly one tag: `Order Import`.
  The import ignores values from the workbook's Tags column so legacy or
  additional tags do not appear.

The single-tag rule was deployed on 2026-07-30:

- Source commit: local `2e76a4d`; deployment-snapshot commit `7fc6acd`
- Render deploy: `dep-d9l5eg8ae00c738fil4g`
- Validation: 57 tests, typecheck, lint, production build, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.
- Existing Shopify orders are not retroactively retagged.

## Imported line-item prices

New imported orders use the unit price from Excel's `Line: Price` column, not
the current Shopify catalog price:

- The parsed `unitPrice` is retained through `importReadyOrders`.
- `createHistoricalOrder` sends the verified `variantId`, quantity, and a
  `priceSet.shopMoney` containing the Excel unit price and workbook currency.
- Missing, negative, or non-finite prices are blocked before Shopify order
  creation. Zero remains a valid import price.

This behavior was deployed on 2026-07-30:

- Source commit: local `c78fd81`; deployment-snapshot commit `0b11e17`
- Render deploy: `dep-d9l5go3l550s73fkh1b0`
- Validation: 59 tests, typecheck, lint, production build, Shopify `2026-07`
  GraphQL code generation, and `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.
- The change applies to newly imported orders and does not recalculate existing
  Shopify orders.

## Imported order shipping address

The request to use the Shopify customer's default address as the imported
order's shipping address is completed and deployed:

- Source commit: local `19b676a`; deployment-snapshot commit `f833d74`
- Render deploy: `dep-d9l56f5aeets73agudu0`
- Validation: 55 tests, typecheck, lint, production build, and Shopify
  `2026-07` GraphQL code generation passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

`findCustomerProfilesByEmail` now retains both the formatted address used by
the preview UI and a structured `defaultShippingAddress`.
`importReadyOrders` resolves the normalized customer email from the job cache
and passes that structured address to `createHistoricalOrder`, which sends it
as `shippingAddress` in `orderCreate`.

The previous chat also reported creating `KDC-Order-Import-Sample.xlsx`, but
that workbook and its generator were not present in this project when the
handoff was refreshed. Recreate or verify it before promising that sample file
in a future chat.

## Fulfilled order-line replacement safeguard

The reported issue where replacing a product added the new product while the
old product remained visible is fixed and deployed:

- Source commit: local `4b24891`; deployment-snapshot commit `af02f2b`
- Render deploy: `dep-d9l5bhe417fc73d68rhg`
- Validation: 56 tests, typecheck, lint, production build, Shopify `2026-07`
  GraphQL code generation, and `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

Shopify permits an order edit to replace or remove only a fully unfulfilled
line. A fulfilled or partially fulfilled line remains part of the order and
fulfillment history. The app now reads `unfulfilledQuantity` and
`merchantEditable`, disables replacement controls for locked lines, explains
the limitation in the editor, and performs preflight and calculated-order race
checks before adding the replacement variant. This prevents another new
product from being added when Shopify cannot remove the old one.

For an order already affected, such as the reported order `#1002`, do not
silently mutate the live order. The operator must:

1. Remove the accidentally added, still-unfulfilled replacement line by
   setting its quantity to zero in the app.
2. In Shopify Admin, open the old product's fulfilled card, choose `...`, and
   cancel its fulfillment.
3. Refresh the Order Import app and replace the now-unfulfilled old line.

Shopify will retain fulfillment/audit history even after correction; the old
fulfilled product cannot be erased from historical records by a normal order
edit.

## Order-level preorder customer message

The Shopify order editor now stores two merchant-editable fields against the
order without changing any product, variant, image, quantity, or product price:

- `custom.preorder_eta` (`single_line_text_field`)
- `custom.preorder_pending_price` (`number_decimal`)

The fields appear in the order editor's **Preorder customer message** section.
Both fields are required when the message is enabled; clearing both deletes the
message. The app creates pinned ORDER metafield definitions when first saved
and grants Customer Account API read access. The customer-facing text is always
generated from this fixed template:

`Arriving {ETA}. Pay the remaining {formatted pending price} before dispatch.`

Only the ETA and pending amount are editable. The pending amount is
informational and does not alter the Shopify order total, outstanding balance,
or product price.

This feature was deployed on 2026-07-30:

- Order Import source commit: local `6aa5568`; deployment-snapshot commit
  `820c563`
- Render deploy: `dep-d9l60bf10e5c73fsohu0`
- Customer account source:
  `../kdc-single-store-final/kdc-account-single-store/extensions/kdc-account/src/FullPageExtension.jsx`
- Customer account app release: `preorder-order-message-1`
- Shopify app version:
  `https://dev.shopify.com/dashboard/227614855/apps/402981945345/versions/1069468385281`
- Validation: 61 importer tests, typecheck, lint, importer production build,
  customer account app build, formatting checks, Shopify Admin GraphQL
  `2026-07` code generation, and `git diff --check` passed.
- Production verification: Order Import `GET /auth/login` and `GET /` returned
  HTTP 200; Shopify CLI confirmed the customer account version was released to
  users.
- No live order values were changed during deployment. An administrator must
  open a specific order in Order Import and save the ETA and pending amount.

First-save metafield definition creation was corrected after Shopify rejected
the generic `PUBLIC_READ_WRITE` admin access value for the merchant-owned
`custom.*` namespace. Definitions now use Shopify's required
`MERCHANT_READ_WRITE` value:

- Source commit: local `0609881`; deployment-snapshot commit `22c0835`
- Render deploy: `dep-d9l68qv10e5c73ft4fs0`
- Validation: 62 tests, typecheck, lint, production build, formatting, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

## Important source locations

- Pending list and confirmation UI: `app/routes/app.preview.tsx`
- Order detail page: `app/routes/app.preview_.order.tsx`
- Pending workbook endpoint:
  `app/routes/app.api.export-pending-xlsx.tsx`
- In-memory jobs, selection, import loop, and Excel export:
  `app/services/ephemeral-imports.server.ts`
- Workbook parsing and image URL rules:
  `app/services/workbook.server.ts`
- Shopify customer lookup and `orderCreate`:
  `app/services/shopify-orders.server.ts`
- Exact variant-image verification:
  `app/services/variant-verification.server.ts`
- Fulfillment normalization:
  `app/lib/fulfillment-status.ts`
- UI styles: `app/styles.css`
- Shopify order list: `app/routes/app.orders.tsx`
- Shopify order editor: `app/routes/app.orders_.order.tsx`
- Shopify order-management queries and mutations:
  `app/services/shopify-order-manager.server.ts`
- Order-management regression tests:
  `tests/shopify-order-manager.test.ts`
- Unit tests: `tests/`
- Deployment configuration: `render.yaml`, `shopify.app.toml`, and
  `shopify.app.order-import.toml`

## Verification and deployment

For behavior changes, run from `kdc-order-importer/`:

```bash
npm test
npm run typecheck
npm run build
```

Run the focused test file first when iterating, then the full suite before
handoff. Do not claim a live deployment merely because a build passes.

The prior conversation reported that the order-detail page, strict Shopify CDN
validation, confirmation flow, pending Excel download, and embedded-navigation
fix had been deployed live and that tests/builds passed at that time. Treat
that as historical handoff information, not proof of the current production
revision. Verify the current deployment when a future task requires live
changes.

## Original request sequence captured from the previous full context

1. Add a single-order detail page because an order can contain multiple items.
2. Restrict Excel image URLs to the Shopify CDN format
   `https://cdn.shopify.com/s/files/`.
3. Move the import button inside the status card at the top-right.
4. Before import, show a confirmation popup, require typing `YES`, show ready,
   missing/invalid-image, and total-pending counts, and allow downloading the
   pending Excel file.
5. Fix broken order-detail navigation inside Shopify Admin.
6. Make an order-number click open the full detail page with customer data,
   total, shipping address, all items, and order status.
7. Remove long navigation delays by using in-app routing and caching Shopify
   customer profile lookups for the pending job.
8. Add mandatory `Fulfillment Status` validation: blank means fulfilled;
   incomplete nonblank values block the entire order.
9. Provide a sample workbook covering ready, multi-item, blank-status, and
   blocked-unfulfilled examples (the previously reported generated file is not
   currently present and needs to be recreated or verified).
10. Use the matched customer's default Shopify address as the shipping address
    on the imported order. Completed and deployed on 2026-07-30.
11. Add a Shopify Orders menu that lists store orders and supports editing the
    shipping address/contact, shipping charge, quantities, product/variant
    assignment with image verification, and irreversible eligible-order
    deletion.

This file is the durable project context for the next Codex edit. Update it
when product rules, deployment targets, or significant unfinished work change.
