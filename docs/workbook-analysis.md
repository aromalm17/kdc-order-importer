# KDC order-history workbook analysis

Generated from `OrderHistoryFinal26072026.xlsx` without modifying the source workbook.

## Workbook summary

- Sheets: `Orders`
- Sheet count: **1**

## Sheet: Orders

- Total data rows: **2141**
- Detected columns (14): `Command`, `Name`, `Customer: Email`, `Payment: Status`, `Line: Type`, `Line: Title`, `Line: SKU`, `Line: Image`, `Line: Variant ID`, `Line: Price`, `Line: Quantity`, `Processed At`, `Currency`, `Transaction: Gateway`
- Unique order count: **1514**
- Multi-item order count: **333**
- Maximum items in one order: **20**
- Orders missing customer emails: **13** (640 blank row cells, including continuation lines)
- Orders missing phone numbers: **1514** (2141 blank row cells)
- Missing variant IDs: **1307**
- Invalid variant IDs: **0**
- Missing SKUs: **2089**
- Missing image URLs: **1304**
- Invalid image URLs: **0**
- Shopify Admin URLs incorrectly used as images: **312**
- Invalid dates: **0**
- Invalid quantities: **0**
- Invalid prices: **0**
- Duplicate order identifiers / grouped multi-row identifiers: **333**
- Currency values: `INR`
- Payment statuses: `Canceled`, `Paid`, `Partially refunded`, `Refunded`
- Fulfilment statuses: _none_

### Detected field mapping

| Destination field | Source column |
|---|---|
| `orderId` | _not detected_ |
| `orderName` | `Name` |
| `email` | `Customer: Email` |
| `phone` | _not detected_ |
| `variantId` | `Line: Variant ID` |
| `sku` | `Line: SKU` |
| `image` | `Line: Image` |
| `date` | `Processed At` |
| `quantity` | `Line: Quantity` |
| `price` | `Line: Price` |
| `currency` | `Currency` |
| `payment` | `Payment: Status` |
| `fulfillment` | _not detected_ |


## Default KDC mapping profile

```json
{
  "name": "KDC Order History",
  "sourceSheet": "Orders",
  "columns": {
    "orderId": null,
    "orderName": "Name",
    "email": "Customer: Email",
    "phone": null,
    "variantId": "Line: Variant ID",
    "sku": "Line: SKU",
    "image": "Line: Image",
    "date": "Processed At",
    "quantity": "Line: Quantity",
    "price": "Line: Price",
    "currency": "Currency",
    "payment": "Payment: Status",
    "fulfillment": null
  }
}
```

## Interpretation

Rows sharing the same detected source order ID or order name are line items of one order. A missing or malformed Shopify variant ID is a hard block until a verified variant mapping is supplied. Image URL checks are syntactic in this offline analysis; the import preview performs HTTP content-type validation and verifies the current Shopify product image through Admin GraphQL.
