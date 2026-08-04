# Codex handoff: KDC Order Importer

Last refreshed: 2026-08-04

## Bulk preorder status filter (2026-08-04)

The Bulk Preorders product list now hides fully configured preorder products by
default. A product is configured only when it has the `preorder`/`pre-order`
tag and nonblank `custom.preorder_eta` and
`custom.preorder_pending_price` product metafields.

The same page includes a status filter with `Needs setup` (default),
`Configured`, and `All products`. Search, clear-search, and refresh preserve the
selected status. The table also displays each product's computed status.

Validation: 92 tests, typecheck, lint, production build, and diff check passed.

## Product-level preorder editor and historical-order classification (2026-08-04)

Bulk Preorders now writes preorder data to the Shopify product represented by
the matching historical orders, rather than writing the same data onto each
order. Saving both fields adds the product tag `Preorder` and sets product
metafields `custom.preorder_eta` and `custom.preorder_pending_price`. Clearing
both fields removes those product values and tag.

The app scope now includes `write_products`. Shopify app configuration release
`order-import-5` is live:
https://dev.shopify.com/dashboard/172441662/apps/400685236225/versions/1075423936513

The theme customer account also treats an unfulfilled historical line as a
preorder when its current linked product has the `preorder`/`pre-order` tag and
both product metafields. This lets already imported orders appear in Pre-Orders
without attempting to rewrite historical line-item properties.

Validation: 92 tests, typecheck, lint, production build, diff check, and Theme
Check completed. Theme Check reported only the documented pre-existing error
and unrelated warnings.

- Source/deployment commit: `bb94ae5`
- Production health: HTTP 200 with `{"status":"ok"}` and `Cache-Control: no-store`
- Live theme: `Kerala Diecast Cars Version 1.0.83`, ID `156621963454`

## Preorder metafield import and live deployment (2026-08-04)

The importer now treats any product with both preorder metafields present as a
preorder item:

- `custom.preorder_eta`
- `custom.preorder_pending_price`

Those values are carried through the workbook verification path, written onto
imported order line-item properties, and preserved when the importer creates
historical orders. The backend also keeps the preorder variant editor in sync
with the same product-level metafield detection so the same preorder flag is
used across import, bulk editing, and storefront/customer-account rendering.

- Local source commit: `03c4d36`
- Deploy branch push: `main` on `deploy`
- Production verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`
- Result: live importer behavior updated successfully

## Bulk Shopify-order selection and delete-all control (2026-08-03)

The Shopify orders list now includes a checkbox column with a select-all
header control and a bulk delete action for the currently selected orders on
the page. The destructive action reuses the existing Shopify `orderDelete`
mutation path, confirms in the browser before submit, and returns a success
banner with the number of orders removed.

## Saved customer address fallback and restriction (2026-08-03)

Historical imports now fetch the Shopify customer by workbook email, prefer
the customer's `defaultAddress`, and fall back to the first address returned
by `addressesV2` when no default is set. The selected structured address is
sent as `orderCreate.shippingAddress`, and the matched Shopify customer ID is
used with `orderCreate.customer.toAssociate` when available. `lastName`
remains optional, but a usable saved address with `address1` is mandatory. A
missing customer, failed lookup, or missing usable saved address blocks the
order before `orderCreate`; the final creation service repeats the address
check.

- Local source commit: `1dbc734`
- Deployment snapshot commit: `2b8cdef24dd22eb637511175817b8161600abdea`
- Render deploy: `dep-d9nrfrdaeets73cib020` (live)
- Validation: 87 tests, typecheck, lint, production build, and
  `git diff --check` passed.
- Production verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`.
- The deployment restart cleared the temporary in-memory workbook/job. Upload
  the workbook again before importing.

## Excel order-name preservation (2026-08-03)

Future imports now pass the workbook's mapped `Name` value directly to
`OrderCreateOrderInput.name`. A source `Name` such as `#2660` therefore appears
as `#2660` in the Shopify Orders list instead of receiving a generated name
such as `#1012`. The `#` and source number are preserved; surrounding
whitespace is trimmed. This controls the merchant-visible order name, not
Shopify's immutable internal GraphQL order GID. Existing imported orders are
not renamed retroactively.

- Local source commit: `8e2d3ad`
- Deployment snapshot commit: `66c2367a59060c080fd17023874fb8b1c8f6d5b0`
- Render deploy: `dep-d9nr4pu7bikc73cg7h3g` (live)
- Validation: 86 tests, typecheck, lint, production build, and
  `git diff --check` passed.
- Production verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`.
- The deployment restart cleared the temporary in-memory workbook/job. Upload
  the workbook again before importing.

## Unfulfilled `orderCreate` fix (2026-08-03)

Shopify Admin GraphQL `OrderCreateFulfillmentStatus` does not include
`UNFULFILLED`; its accepted explicit values are `FULFILLED`, `PARTIAL`, and
`RESTOCKED`. `OrderCreateOrderInput.fulfillmentStatus` defaults to unfulfilled
when omitted. The importer now sends `FULFILLED` only for completed orders and
omits the field for orders marked Unfulfilled. Unknown statuses remain blocked.

- Local source commit: `44d2f48`
- Deployment snapshot commit: `cb82c1e3cb32201ff5a4ac6c16dbd467495a904b`
- Render deploy: `dep-d9nqvhrm8hqs73euf1l0` (live)
- Validation: 86 tests, typecheck, lint, production build, and
  `git diff --check` passed.
- Production verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`.
- The deployment restart cleared the temporary in-memory workbook/job. The
  merchant must upload it again before retrying the affected orders.

## Excel order-line titles (2026-08-02)

Future historical imports now pass the workbook's mapped `Line: Title` value
as `OrderCreateLineItemInput.title`. The verified Shopify Variant GID is still
sent on the same line, preserving the variant association, while the workbook
continues to control quantity and unit price. Existing Shopify orders are not
renamed retroactively.

- Local source commit: `31e8961`
- Deployment snapshot commit: `66447fabedfbdc350129b1b596ed4e86a84dc1e8`
- Render deploy: `dep-d9noio7qj5pc73fbc4dg`
- Validation: 86 tests, typecheck, lint, production build, and
  `git diff --check` passed.
- Production verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`.
- The deployment restart cleared temporary in-memory workbook/job data.

Follow-up: variant/image verification previously replaced `productTitle` with
the Shopify catalog title before `orderCreate`. That assignment was removed so
the parsed workbook title survives the complete verification and import path.

- Follow-up source commit: `e460a94`
- Follow-up deployment commit: `6ed627df88417ea37d6c01309608778f6731c4e5`
- Follow-up Render deploy: `dep-d9nond5aeets73cdefc0` (live)
- Validation remained 86 passing tests plus typecheck, lint, production build,
  and `git diff --check`; `/healthz` returned HTTP 200 after deployment.

## Bulk preorder editor by exact variant (2026-08-02)

The embedded app now has a `Bulk Preorders` menu for updating the same
order-level preorder message across multiple Shopify orders that contain an
exact product variant.

- `/app/preorders` scans Shopify orders and groups matching lines by exact
  Shopify Variant GID, so differently colored or configured variants remain
  separate even when their product title is shared.
- The group list can be filtered by product ID, variant ID, SKU, or title. It
  is sorted by matching order count descending, then latest order date.
- `/app/preorders/variant?id=...` shows all scanned orders for one exact
  variant newest-first. All are initially selected; the merchant can deselect
  individual orders before applying one Arrival ETA and Pending price.
- Submitting updates only the existing order metafields
  `custom.preorder_eta` and `custom.preorder_pending_price`. It never changes
  the product, variant, image, quantity, or product price.
- Clearing both editor values removes both preorder metafields from the
  selected orders.
- The action intersects submitted order IDs with the selected variant's
  server-side order set before writing, preventing arbitrary order updates.
- The product index is cached per shop for five minutes. `Refresh products`
  bypasses and replaces that cache.
- The current bounded scan covers the latest 1,000 orders and up to 25 current
  line items per order. If the store grows beyond this, replace the request
  pagination with a Shopify bulk operation rather than raising limits on the
  Render free instance.

Validation: 86 tests, typecheck, lint, production build, and `git diff --check`
passed. GraphQL code generation could not complete because the remote schema
loader stalled; the deployed query/mutation fields reuse the already supported
Admin GraphQL order and metafield shapes.

- Local source commit: `bfe5a13`
- Deployment snapshot commit: `4cbedc5a719a59b487aa2b5fb100f616eec7b25c`
- Render deploy: `dep-d9nobklaeets73ccof50`
- Render status: live on 2026-08-02
- Production health verification: `/healthz` returned HTTP 200 with
  `{"status":"ok"}`.
- The deployment restart cleared temporary in-memory workbook/job data. It
  did not edit Shopify orders; order metafields change only after a merchant
  submits the bulk editor.

## Workbook memory-bound fix (2026-08-02)

The service still reached the 384 MB JavaScript heap ceiling after an
authenticated import request. The recurring `/healthz` requests were healthy;
the remaining risk was the workbook path: the app allowed a 25 MB compressed
XLSX, expanded the complete archive in memory, and retained superseded import
jobs for the full 24-hour TTL even though only the latest job was accessible.

The deployed fix:

- Allows only one active in-memory import job per shop and removes superseded
  jobs before expanding a replacement workbook.
- Cleans stale `latestByShop` references when TTL cleanup removes a job.
- Rejects request bodies and compressed XLSX files above 8 MB before parsing.
- Reads XLSX ZIP central-directory metadata and rejects archives with more than
  500 entries, more than 256 MB total expanded archive content, or more than
  32 MB of parseable order/XML content. Embedded media, workbook objects, and
  printer data are stripped from a temporary parsing copy before the Excel
  reader runs.
- Rejects a selected sheet above 10,000 data rows with a clear instruction to
  split the workbook.
- Returns HTTP 413/resource-limit messages rather than letting unsafe uploads
  exhaust the Render free instance.
- Updates the Shopify React Router dependency declaration to the already
  installed current `1.2.1` release and adds the explicit archive-inspection
  dependency/types.

Validation: 84 tests, typecheck, lint, production build, changed-file Prettier
checks, and `git diff --check` passed.

- Local source commit: `f999e47`
- Deployment snapshot commit: `130e347c3114572ae6e23feaedce85f31a6a2c16`
- Render deploy: `dep-d9nlqsrm8hqs73ekukt0`
- Render status: live on 2026-08-02
- Media-safe follow-up source commit: `8e74378`
- Media-safe deployment commit: `a67083966af1abe551235f1311eed650f7c73170`
- Current Render deploy: `dep-d9nm7961egvs738ccfdg` (live)
- Post-deploy verification: `/healthz` returned HTTP 200 with `no-store`; logs
  stayed at roughly 1–2 ms for more than two minutes past the prior crash
  window, with no OOM or process restart.
- The deployment restart cleared all previous temporary in-memory jobs and
  workbook data as explicitly requested.

Operational consequence: a new valid workbook replaces the shop's existing
pending import. Download the pending workbook first if it must be retained.
Files above any safe limit must be split into smaller `.xlsx` workbooks.

## Production reliability fix (2026-08-02)

The production service was reported crashing with `JavaScript heap out of
memory` after repeated `/auth/login` requests and offline-token exchanges.
The fix is committed locally as `b428612`, pushed to the deployment repository
as snapshot commit `da065fb`, and deployed live on Render.

The deployed fix:

- Adds an unauthenticated, no-store `/healthz` endpoint and changes
  `render.yaml` away from the authentication-heavy `/auth/login` health check.
- Starts React Router directly with Node instead of two nested npm processes.
- Sets the container's Node old-space ceiling to 384 MB on Render's 512 MB free
  instance.
- Loads ExcelJS only when generating a pending workbook export instead of at
  server startup.
- Adds a health endpoint regression test.

Validation completed before the push: 79 tests, typecheck, lint, production
build, supported-file Prettier checks, `git diff --check`, direct production
startup command, and local `/healthz` HTTP 200 verification.

- Final Render deploy: `dep-d9nl3mm417fc73djui60`
- Render service health-check path: `/healthz`
- Production verification: `/healthz`, `/auth/login`, and `/` returned HTTP
  200. Post-deploy logs show the recurring health probe using `/healthz`
  instead of `/auth/login`, with responses around 1–3 ms.
- The deployment cleared temporary in-memory workbook/job data as expected.

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

The Dashboard and New Import routes both show the same workbook uploader and
the same "What happens next" instructions. They share one server-side upload
handler, so file validation, parsing, Shopify variant-image verification,
in-memory job creation, and preview redirection must remain identical on both
screens.

This shared Dashboard uploader was deployed on 2026-07-30:

- Source commit: local `2ea18e0`; deployment-snapshot commit `98eff04`
- Render deploy: `dep-d9l6arrl550s73fljqqg`
- Validation: 62 tests, typecheck, lint, production build, formatting, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

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

The native Shopify customer-account order-detail page now has a separate
static extension that renders once after the Items list:

- Source:
  `../kdc-single-store-final/kdc-account-single-store/extensions/preorder-order-message/`
- Target:
  `customer-account.order-status.cart-line-list.render-after`
- It declares and reads the order metafields `custom.preorder_eta` and
  `custom.preorder_pending_price` through `shopify.appMetafields`.
- It renders nothing unless both fields have values. When both exist it shows
  the fixed sentence `Arriving {ETA}. Pay the remaining {amount} before
  dispatch.`
- This must remain a separate UI extension from `kdc-account`, because Shopify
  does not permit `customer-account.page.render` to be combined with any other
  target in one extension package.
- Customer Profile app version: `native-preorder-order-message-1`
- Shopify version:
  `https://dev.shopify.com/dashboard/227614855/apps/402981945345/versions/1069531004929`
- `shopify app build` passed, the app version was released to users, and
  `shopify app info --json` reports both the original full-page extension and
  the new native order-detail extension with both declared metafields.

The live storefront's visible **My Account** order detail is not Shopify's
Customer Account extension surface. It is rendered by the theme snippet
`../snippets/customer-account-dashboard.liquid`. Therefore the released static
extension above does not control the page shown in the user's screenshots.
Theme release `Kerala Diecast Cars Version 1.0.0` added the same fixed sentence
directly to that snippet using the two order metafields and was published live
on 2026-07-30. Theme release `Kerala Diecast Cars Version 1.0.1` subsequently
added the homepage RC Cars section. Version `1.0.2` added the separate RC Cars
page and navigation and is now live. Versions `1.0.1`, `1.0.0`, and
`KDC Pre-Chat Restore` remain intact for rollback. See
`../THEME_RELEASE_HANDOFF.md`; the next theme name is
`Kerala Diecast Cars Version 1.0.3`.

The customer account Shopify app was renamed from
`KDC Account Single Store` to `Customer Profile` on 2026-07-30:

- Configuration:
  `../kdc-single-store-final/kdc-account-single-store/shopify.app.toml`
- Released Shopify app version: `customer-profile-name-1`
- Shopify version:
  `https://dev.shopify.com/dashboard/227614855/apps/402981945345/versions/1069488177153`
- `shopify app build` passed, Shopify CLI confirmed the version was released
  to users, and `shopify app info --json` reports `Customer Profile`.
- The extension's internal handle remains `kdc-account`; do not change the
  handle merely to match the visible app name because that can break links.

First-save metafield definition creation was corrected after Shopify rejected
both `PUBLIC_READ_WRITE` and `MERCHANT_READ_WRITE` as explicit Admin access
values for the merchant-owned `custom.*` namespace. Do not set
`access.admin` when creating these definitions. Omit it so Shopify applies the
merchant-owned Admin default, and set only `customerAccount: READ`:

- Source commit: local `6287834`; deployment-snapshot commit `4952d87`
- Render deploy: `dep-d9l6nspt0dsc73fsu950`
- Validation: 62 tests, typecheck, lint, production build, formatting, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

The Pending Orders status card now has a **Clear current import** action:

- It asks for confirmation, removes the entire current ephemeral workbook/job,
  and redirects to **New Import**.
- It clears only temporary in-memory import data. It does not delete any order
  already imported into Shopify.
- The action is disabled while an import is running and reports server errors
  in the existing critical banner.
- Source commit: local `262bddd`; deployment-snapshot commit `50d3cd6`
- Render deploy: `dep-d9lbfju7bikc738ocqhg`
- Validation: 63 tests, typecheck, lint, production build, formatting, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

The **Download pending Excel** export now contains only not-ready/blocked
orders. Ready orders remain visible and selectable in the pending screen but
are excluded from both the Excel and legacy CSV pending-export generators:

- Source commit: local `d253ace`; deployment-snapshot commit `e8d5f3e`
- Render deploy: `dep-d9lcdaid0e5s73c8dnp0`
- Validation: 64 tests, typecheck, lint, production build, formatting, and
  `git diff --check` passed.
- Production verification: normal `GET /auth/login` and `GET /` returned HTTP
  200.

The Pending Orders status card now includes a bulk fulfillment-status editor:

- The merchant can paste order numbers separated by commas, whitespace, new
  lines, or semicolons, with or without the leading `#`.
- **Mark as Unfulfilled** changes matching temporary import records to
  `Unfulfilled`, meaning not shipped. It does not block those records or make
  them Not Ready.
- When imported, those records are created in Shopify with
  `fulfillmentStatus: UNFULFILLED`; normal Fulfilled records continue to use
  `FULFILLED`.
- The action reports unmatched order numbers. It does not edit existing
  Shopify orders or alter payment/product data.
- Excel-provided incomplete fulfillment values still follow the mandatory
  workbook validation rule above. This explicit merchant action removes only
  the `INCOMPLETE_FULFILLMENT_STATUS` issue for the matching pending records.
- Source commit: local `37383fc`; deployment-snapshot commit `653c251`
- Render deploy: `dep-d9lcjabm8hqs738eclo0`
- Validation: 65 tests, typecheck, lint, production build, formatting,
  Shopify Admin GraphQL API `2026-07` code generation, and `git diff --check`
  passed.
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
