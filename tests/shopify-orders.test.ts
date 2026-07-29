import { describe, expect, it, vi } from "vitest";
import { createHistoricalOrder } from "../app/services/shopify-orders.server";

describe("Shopify order creation", () => {
  it("submits variant-backed line items and suppresses historical notifications", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: { orderCreate: { order: { id: "gid://shopify/Order/1", name: "#1001" }, userErrors: [] } },
      }),
    });
    const result = await createHistoricalOrder(
      { graphql } as never,
      {
        customerEmail: "buyer@example.com",
        currency: "INR",
        financialStatus: "Paid",
        tags: ["KDC-Historical-Import"],
        lineItems: [{ variantId: "gid://shopify/ProductVariant/100", quantity: 2 }],
      },
    );
    expect(result.name).toBe("#1001");
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("orderCreate"),
      expect.objectContaining({
        variables: expect.objectContaining({
          options: { sendReceipt: false, sendFulfillmentReceipt: false },
        }),
      }),
    );
  });

  it("refuses custom or unmapped line items before GraphQL", async () => {
    await expect(
      createHistoricalOrder(
        { graphql: vi.fn() } as never,
        {
          currency: "INR",
          tags: [],
          lineItems: [{ variantId: null, quantity: 1 }],
        },
      ),
    ).rejects.toThrow("verified Shopify variant ID");
  });
});

