# KDC Order Importer

Embedded Shopify custom app for importing Kerala Diecast Cars historical orders from Excel into `keraladiecastcars.myshopify.com`.

## Included

- Official Shopify React Router template, App Bridge, and Polaris web components
- OAuth/offline sessions and custom single-merchant distribution
- Admin GraphQL API `2026-07`
- In-memory Shopify sessions and import state; no application database
- `.xlsx` upload, sheet/header detection, KDC mapping, and multi-row order grouping
- Whole-order blocking for unverified variants, missing product images, or invalid source data
- Pending-only preview and downloadable CSV for unresolved or failed rows
- Variant-backed `orderCreate` only; historical notifications disabled
- Shopify uninstall/privacy webhooks
- Unit tests, mocked GraphQL tests, Playwright, Docker, and a free Render blueprint

The source workbook is not modified or bundled. Its analysis is in [docs/workbook-analysis.md](docs/workbook-analysis.md).

## Local setup

```bash
cp .env.example .env
npm ci
shopify app config link
npm run dev
```

Set the custom distribution store to `keraladiecastcars.myshopify.com`, configure the production HTTPS URL, deploy the app configuration, and have the store owner approve installation.

## Required access

`read_products, read_customers, write_customers, read_orders, write_orders, write_order_edits, read_all_orders`

`read_all_orders` can require approval. Names, email, phone, addresses, orders, and customers are protected customer data; request only the required fields in Shopify Dev Dashboard.

## Safe workflow

1. Upload `.xlsx` (25 MB maximum by default).
2. Review detected columns and grouped orders.
3. Correct missing variants or other blocked rows in the source workbook.
4. Import a 1–3 order test batch.
5. Compare customers, line items, totals, dates, tags, and statuses in Shopify Admin.
6. Increase the batch only after merchant acceptance.

No custom/free-text items are created. One invalid line blocks its entire order.
Successfully imported orders are removed from the app's in-memory list immediately.
Pending and failed orders are never persisted; download the pending CSV before a
service restart or redeploy.

## Commands

```bash
npm run analyze:workbook -- /absolute/path/OrderHistoryFinal26072026.xlsx
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

## Production

Run the single web service defined in `render.yaml`. It does not require
PostgreSQL, a background worker, or persistent disk. Because pending state is
memory-only, it is intentionally cleared when the process restarts.

Live order mutations were not executed without a merchant-installed app and approved scopes. Remaining live actions are linking the correct Dev Dashboard app, approvals, owner installation, and a controlled test batch.

See [docs/architecture.md](docs/architecture.md), [docs/deployment.md](docs/deployment.md), and [SECURITY.md](SECURITY.md).
