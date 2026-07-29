import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ParsedOrder } from "../lib/import-types";
import {
  applyVariantImageVerification,
  rebuildOrderIssues,
} from "./workbook.server";
import { verifyVariants } from "./shopify-orders.server";

export async function verifyOrderVariantImages(
  admin: AdminApiContext,
  orders: ParsedOrder[],
) {
  const variantIds = [
    ...new Set(
      orders
        .flatMap((order) => order.lineItems)
        .map((line) =>
          line.variantId?.replace("gid://shopify/ProductVariant/", ""),
        )
        .filter((id): id is string => Boolean(id && /^\d+$/.test(id))),
    ),
  ];
  const verified = await verifyVariants(admin, variantIds);

  for (const order of orders) {
    for (const line of order.lineItems) {
      const numericId = line.variantId?.replace(
        "gid://shopify/ProductVariant/",
        "",
      );
      if (!numericId) continue;
      applyVariantImageVerification(line, verified.get(numericId));
    }
    rebuildOrderIssues(order);
  }

  return orders;
}
