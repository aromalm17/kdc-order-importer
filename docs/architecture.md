# Architecture

- **Web:** React Router embedded Admin UI, OAuth, upload, preview, and import actions.
- **State:** in-memory only, with no application database or persistent uploads.
- **Shopify:** Admin GraphQL `2026-07` with an offline token for `orderCreate`.

An import progresses from preview through running to completed. Successful
orders are removed from memory immediately. Only pending or failed rows remain,
and the merchant can download them as CSV. All state is cleared by a process
restart.

An order becomes ready only when every line has a verified ProductVariant, current product image, positive integer quantity, and valid price. The app never falls back to a custom line item.

All app routes authenticate through Shopify's official library. Uploaded
workbooks are parsed in memory and are not written to disk. Privacy webhooks do
not need to delete application records because none are persisted.
