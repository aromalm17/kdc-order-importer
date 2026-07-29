import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const workbookPath =
  process.argv[2] ??
  path.resolve(process.cwd(), "..", "..", "OrderHistoryFinal26072026.xlsx");
const outputPath =
  process.argv[3] ??
  path.resolve(process.cwd(), "docs", "workbook-analysis.md");

type RowData = Record<string, string>;

const aliases = {
  orderId: ["order id", "source order id"],
  orderName: ["name", "order", "order name", "order number", "order no"],
  email: ["email", "customer email", "contact email"],
  phone: ["phone", "customer phone", "shipping phone", "billing phone"],
  variantId: ["lineitem variant id", "variant id", "variant_id"],
  sku: ["line sku", "lineitem sku", "sku"],
  image: ["line image", "lineitem image", "image", "image url", "product image"],
  date: ["processed at", "created at", "date", "order date"],
  quantity: ["line quantity", "lineitem quantity", "quantity", "qty"],
  price: ["line price", "lineitem price", "price", "unit price"],
  currency: ["currency"],
  payment: ["financial status", "payment status"],
  fulfillment: ["fulfillment status", "fulfilment status"],
} as const;

function normalized(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  if (typeof value === "object" && value && "result" in value) {
    return normalized((value as { result: unknown }).result);
  }
  return String(value).trim();
}

function resolveColumn(headers: string[], candidates: readonly string[]) {
  const canonical = (input: string) =>
    input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedHeaders = headers.map(canonical);
  for (const candidate of candidates) {
    const exact = normalizedHeaders.indexOf(canonical(candidate));
    if (exact >= 0) return headers[exact];
  }
  for (const candidate of candidates) {
    if (canonical(candidate).split(" ").length < 2) continue;
    const partial = normalizedHeaders.findIndex((header) =>
      header.includes(canonical(candidate)),
    );
    if (partial >= 0) return headers[partial];
  }
  return undefined;
}

function value(row: RowData, header?: string) {
  return header ? row[header] ?? "" : "";
}

function validUrl(raw: string) {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validDate(raw: string) {
  return raw !== "" && !Number.isNaN(Date.parse(raw));
}

function isPositiveNumber(raw: string) {
  const parsed = Number(raw.replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0;
}

const sheetNames = await readSheetNames(workbookPath);

const summaries: string[] = [];
const profile: Record<string, string | null> = {};

for (const [sheetIndex, sheetName] of sheetNames.entries()) {
  const sheetRows = await readXlsxFile(workbookPath, { sheet: sheetName });
  const headers = (sheetRows[0] ?? [])
    .map(normalized)
    .filter(Boolean);
  const rows: RowData[] = sheetRows.slice(1).flatMap((sheetRow) => {
    const record: RowData = {};
    headers.forEach((header, index) => {
      record[header] = normalized(sheetRow[index]);
    });
    return Object.values(record).some(Boolean) ? [record] : [];
  });

  const columns = Object.fromEntries(
    Object.entries(aliases).map(([field, candidates]) => [
      field,
      resolveColumn(headers, candidates),
    ]),
  ) as Record<keyof typeof aliases, string | undefined>;

  if (sheetIndex === 0) {
    for (const [key, source] of Object.entries(columns)) profile[key] = source ?? null;
  }

  const identifier = (row: RowData, rowIndex: number) =>
    value(row, columns.orderId) ||
    value(row, columns.orderName) ||
    `generated:${value(row, columns.email)}:${value(row, columns.date)}:${rowIndex}`;

  const grouped = new Map<string, RowData[]>();
  rows.forEach((row, index) => {
    const key = identifier(row, index);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  });
  const duplicateIdentifiers = [...grouped.values()].filter((group) => group.length > 1);
  const ordersMissingEmail = [...grouped.values()].filter((group) =>
    group.every((row) => !value(row, columns.email)),
  ).length;
  const ordersMissingPhone = [...grouped.values()].filter((group) =>
    group.every((row) => !value(row, columns.phone)),
  ).length;
  const imageValues = rows.map((row) => value(row, columns.image));
  const variantValues = rows.map((row) => value(row, columns.variantId));
  const nonNumericVariants = variantValues.filter(
    (entry) => entry && !/^(gid:\/\/shopify\/ProductVariant\/)?\d+$/.test(entry),
  );
  const dates = rows.map((row) => value(row, columns.date));
  const quantities = rows.map((row) => value(row, columns.quantity));
  const prices = rows.map((row) => value(row, columns.price));
  const unique = (header?: string) =>
    [...new Set(rows.map((row) => value(row, header)).filter(Boolean))].sort();

  summaries.push(`## Sheet: ${sheetName}

- Total data rows: **${rows.length}**
- Detected columns (${headers.length}): ${headers.map((header) => `\`${header}\``).join(", ")}
- Unique order count: **${grouped.size}**
- Multi-item order count: **${duplicateIdentifiers.length}**
- Maximum items in one order: **${Math.max(0, ...[...grouped.values()].map((group) => group.length))}**
- Orders missing customer emails: **${ordersMissingEmail}** (${rows.filter((row) => !value(row, columns.email)).length} blank row cells, including continuation lines)
- Orders missing phone numbers: **${ordersMissingPhone}** (${rows.filter((row) => !value(row, columns.phone)).length} blank row cells)
- Missing variant IDs: **${variantValues.filter((entry) => !entry).length}**
- Invalid variant IDs: **${nonNumericVariants.length}**
- Missing SKUs: **${rows.filter((row) => !value(row, columns.sku)).length}**
- Missing image URLs: **${imageValues.filter((entry) => !entry).length}**
- Invalid image URLs: **${imageValues.filter((entry) => entry && !validUrl(entry)).length}**
- Shopify Admin URLs incorrectly used as images: **${imageValues.filter((entry) => /admin\.shopify\.com|\/admin\//i.test(entry)).length}**
- Invalid dates: **${dates.filter((entry) => entry && !validDate(entry)).length}**
- Invalid quantities: **${quantities.filter((entry) => entry && (!Number.isInteger(Number(entry)) || Number(entry) <= 0)).length}**
- Invalid prices: **${prices.filter((entry) => entry && !isPositiveNumber(entry)).length}**
- Duplicate order identifiers / grouped multi-row identifiers: **${duplicateIdentifiers.length}**
- Currency values: ${unique(columns.currency).map((entry) => `\`${entry}\``).join(", ") || "_none_"}
- Payment statuses: ${unique(columns.payment).map((entry) => `\`${entry}\``).join(", ") || "_none_"}
- Fulfilment statuses: ${unique(columns.fulfillment).map((entry) => `\`${entry}\``).join(", ") || "_none_"}

### Detected field mapping

| Destination field | Source column |
|---|---|
${Object.entries(columns)
  .map(([destination, source]) => `| \`${destination}\` | ${source ? `\`${source}\`` : "_not detected_"} |`)
  .join("\n")}
`);
}

const report = `# KDC order-history workbook analysis

Generated from \`${path.basename(workbookPath)}\` without modifying the source workbook.

## Workbook summary

- Sheets: ${sheetNames.map((sheet) => `\`${sheet}\``).join(", ")}
- Sheet count: **${sheetNames.length}**

${summaries.join("\n")}

## Default KDC mapping profile

\`\`\`json
${JSON.stringify(
  {
    name: "KDC Order History",
    sourceSheet: sheetNames[0],
    columns: profile,
  },
  null,
  2,
)}
\`\`\`

## Interpretation

Rows sharing the same detected source order ID or order name are line items of one order. A missing or malformed Shopify variant ID is a hard block until a verified variant mapping is supplied. Image URL checks are syntactic in this offline analysis; the import preview performs HTTP content-type validation and verifies the current Shopify product image through Admin GraphQL.
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, report, "utf8");
console.log(`Wrote ${outputPath}`);
