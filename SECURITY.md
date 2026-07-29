# Security and privacy

- Never commit `.env`, access tokens, workbooks, customer exports, passwords, OTP/2FA codes, or payment credentials.
- Use TLS and least-privilege Shopify access. The app does not persist uploaded
  workbooks, pending rows, or customer data.
- Names, email, phone, addresses, customers, and orders are protected customer data.
- All embedded routes and webhooks use Shopify's official authentication/HMAC verification.
- Historical receipt and fulfilment emails are disabled.
- Logs should contain job/order IDs and error codes, not complete customer payloads.
- Privacy webhooks cover data requests, customer redaction, and shop redaction.

## Dependency audit note

The production dependency audit was run on 29 July 2026. The runtime workbook
reader is `read-excel-file`; `exceljs` is development-only and is never used to
parse merchant uploads in production.

The Shopify React Router application stack currently reports the upstream
`GHSA-qwww-vcr4-c8h2` advisory for React Server Components (RSC). This
application does not enable or expose React Router RSC mode. Re-check and update
the Shopify-supported React Router line when a compatible patched release is
available. Do not enable RSC without completing that update.
