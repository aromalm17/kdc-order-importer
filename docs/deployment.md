# Deployment

## Shopify

1. Create/link the app in Shopify Dev Dashboard.
2. Select custom distribution for `keraladiecastcars.myshopify.com`.
3. Set the production HTTPS app and redirect URLs.
4. Request protected customer fields and `read_all_orders` if required.
5. Run `shopify app deploy`.
6. Have the store owner install the app.

## Render

Provision `render.yaml` and set the Shopify credentials and production URL. The
blueprint creates one free web service. No database, worker, or disk is needed.

## Operations

- Download the pending CSV before a restart or deployment.
- Monitor import progress and Shopify throttle errors.
- Keep concurrency low for the first production batches.
