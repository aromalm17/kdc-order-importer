import { describe, expect, it, vi } from "vitest";
import {
  editManagedOrderLine,
  listManagedOrders,
  permanentlyDeleteManagedOrder,
  replaceManagedShippingCharge,
  updateManagedOrderContact,
} from "../app/services/shopify-order-manager.server";

function response(data: unknown) {
  return {
    json: async () => ({ data }),
  };
}

describe("Shopify order manager", () => {
  it("loads a paginated page of Shopify orders", async () => {
    const graphql = vi.fn().mockResolvedValue(
      response({
        orders: {
          nodes: [
            {
              id: "gid://shopify/Order/1",
              name: "#1001",
              createdAt: "2026-07-30T10:00:00Z",
              updatedAt: "2026-07-30T10:00:00Z",
              email: "buyer@example.com",
              displayFinancialStatus: "PAID",
              displayFulfillmentStatus: "UNFULFILLED",
              cancelledAt: null,
              merchantEditable: true,
              customer: { displayName: "Buyer" },
              currentTotalPriceSet: {
                shopMoney: { amount: "999.00", currencyCode: "INR" },
              },
              lineItems: {
                nodes: [
                  {
                    image: {
                      url: "https://cdn.shopify.com/s/files/1/car.jpg",
                    },
                  },
                ],
              },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "next-cursor" },
        },
      }),
    );

    const result = await listManagedOrders({ graphql } as never, {
      after: "current-cursor",
      query: "#1001",
    });

    expect(result.orders[0]).toMatchObject({
      id: "gid://shopify/Order/1",
      name: "#1001",
      customerName: "Buyer",
      editable: true,
      imageUrl: "https://cdn.shopify.com/s/files/1/car.jpg",
    });
    expect(result.pageInfo.endCursor).toBe("next-cursor");
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("query KdcManagedOrders"),
      {
        variables: {
          first: 50,
          after: "current-cursor",
          query: "#1001",
        },
      },
    );
  });

  it("updates order contact and translates countryCodeV2 to MailingAddressInput", async () => {
    const graphql = vi.fn().mockResolvedValue(
      response({
        orderUpdate: {
          order: {
            id: "gid://shopify/Order/1",
            name: "#1001",
            updatedAt: "2026-07-30T10:01:00Z",
          },
          userErrors: [],
        },
      }),
    );

    await updateManagedOrderContact(
      { graphql } as never,
      "gid://shopify/Order/1",
      {
        email: " buyer@example.com ",
        phone: " +919999999999 ",
        note: " Call first ",
        shippingAddress: {
          firstName: " Aromal ",
          lastName: " M ",
          address1: " House ",
          city: " Kozhikode ",
          provinceCode: "KL",
          zip: "673001",
          countryCodeV2: "in",
          country: "India",
          province: "Kerala",
        },
      },
    );

    const variables = graphql.mock.calls[0][1].variables;
    expect(variables.input).toMatchObject({
      id: "gid://shopify/Order/1",
      email: "buyer@example.com",
      phone: "+919999999999",
      note: "Call first",
      shippingAddress: {
        firstName: "Aromal",
        lastName: "M",
        address1: "House",
        city: "Kozhikode",
        provinceCode: "KL",
        zip: "673001",
        countryCode: "IN",
      },
    });
    expect(variables.input.shippingAddress).not.toHaveProperty("countryCodeV2");
    expect(variables.input.shippingAddress).not.toHaveProperty("country");
    expect(variables.input.shippingAddress).not.toHaveProperty("province");
  });

  it("replaces a line item with a verified variant and suppresses notification", async () => {
    const originalLine = {
      id: "gid://shopify/LineItem/10",
      title: "Old car",
      sku: "OLD",
      quantity: 1,
      variant: { id: "gid://shopify/ProductVariant/100" },
    };
    const calculatedLine = {
      ...originalLine,
      id: "gid://shopify/CalculatedLineItem/10",
    };
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          productVariant: {
            id: "gid://shopify/ProductVariant/200",
            title: "Blue",
            sku: "NEW",
            price: "1099.00",
            image: {
              url: "https://cdn.shopify.com/s/files/1/new-car.jpg?v=2",
            },
            product: {
              id: "gid://shopify/Product/20",
              title: "New car",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditBegin: {
            calculatedOrder: {
              id: "gid://shopify/CalculatedOrder/1",
              originalOrder: { lineItems: { nodes: [originalLine] } },
              lineItems: { nodes: [calculatedLine] },
              shippingLines: [],
            },
            userErrors: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditAddVariant: {
            calculatedLineItem: {
              id: "gid://shopify/CalculatedLineItem/20",
            },
            userErrors: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditSetQuantity: {
            calculatedLineItem: {
              id: "gid://shopify/CalculatedLineItem/10",
              quantity: 0,
            },
            userErrors: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditCommit: {
            order: {
              id: "gid://shopify/Order/1",
              name: "#1001",
              updatedAt: "2026-07-30T10:02:00Z",
            },
            userErrors: [],
          },
        }),
      );

    await editManagedOrderLine({ graphql } as never, {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/10",
      quantity: 2,
      replacementVariantId: "200",
      expectedImageUrl:
        "https://cdn.shopify.com/s/files/1/new-car.jpg?width=100",
      restock: true,
    });

    expect(graphql).toHaveBeenCalledTimes(5);
    expect(graphql.mock.calls[2][1].variables).toEqual({
      id: "gid://shopify/CalculatedOrder/1",
      variantId: "gid://shopify/ProductVariant/200",
      quantity: 2,
    });
    expect(graphql.mock.calls[3][1].variables).toEqual({
      id: "gid://shopify/CalculatedOrder/1",
      lineItemId: "gid://shopify/CalculatedLineItem/10",
      quantity: 0,
      restock: true,
    });
    expect(graphql.mock.calls[4][0]).toContain("notifyCustomer: false");
  });

  it("rejects a replacement when the expected image is not assigned", async () => {
    const graphql = vi.fn().mockResolvedValue(
      response({
        productVariant: {
          id: "gid://shopify/ProductVariant/200",
          title: "Blue",
          sku: "NEW",
          price: "1099.00",
          image: {
            url: "https://cdn.shopify.com/s/files/1/actual.jpg",
          },
          product: { id: "gid://shopify/Product/20", title: "New car" },
        },
      }),
    );

    await expect(
      editManagedOrderLine({ graphql } as never, {
        orderId: "gid://shopify/Order/1",
        lineItemId: "gid://shopify/LineItem/10",
        quantity: 1,
        replacementVariantId: "200",
        expectedImageUrl: "https://cdn.shopify.com/s/files/1/different.jpg",
        restock: false,
      }),
    ).rejects.toThrow("not assigned to the replacement variant");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("replaces committed shipping lines and commits the new charge", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          orderEditBegin: {
            calculatedOrder: {
              id: "gid://shopify/CalculatedOrder/1",
              originalOrder: { lineItems: { nodes: [] } },
              lineItems: { nodes: [] },
              shippingLines: [
                {
                  id: "gid://shopify/CalculatedShippingLine/1",
                  title: "Old shipping",
                },
              ],
            },
            userErrors: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditRemoveShippingLine: { userErrors: [] },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditAddShippingLine: {
            calculatedShippingLine: {
              id: "gid://shopify/CalculatedShippingLine/2",
              title: "Express",
            },
            userErrors: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          orderEditCommit: {
            order: {
              id: "gid://shopify/Order/1",
              name: "#1001",
              updatedAt: "2026-07-30T10:03:00Z",
            },
            userErrors: [],
          },
        }),
      );

    await replaceManagedShippingCharge({ graphql } as never, {
      orderId: "gid://shopify/Order/1",
      title: "Express",
      amount: "150",
      currencyCode: "INR",
    });

    expect(graphql.mock.calls[1][1].variables).toEqual({
      id: "gid://shopify/CalculatedOrder/1",
      shippingLineId: "gid://shopify/CalculatedShippingLine/1",
    });
    expect(graphql.mock.calls[2][1].variables.shippingLine).toEqual({
      title: "Express",
      price: { amount: "150.00", currencyCode: "INR" },
    });
    expect(graphql.mock.calls[3][0]).toContain("orderEditCommit");
  });

  it("requires the exact order-specific confirmation before deletion", async () => {
    const graphql = vi.fn();

    await expect(
      permanentlyDeleteManagedOrder({ graphql } as never, {
        orderId: "gid://shopify/Order/1",
        expectedOrderName: "#1001",
        confirmation: "DELETE",
      }),
    ).rejects.toThrow('Type "DELETE #1001" exactly');
    expect(graphql).not.toHaveBeenCalled();
  });

  it("permanently deletes an eligible confirmed Shopify order", async () => {
    const graphql = vi.fn().mockResolvedValue(
      response({
        orderDelete: {
          deletedId: "gid://shopify/Order/1",
          userErrors: [],
        },
      }),
    );

    const deletedId = await permanentlyDeleteManagedOrder(
      { graphql } as never,
      {
        orderId: "gid://shopify/Order/1",
        expectedOrderName: "#1001",
        confirmation: "DELETE #1001",
      },
    );

    expect(deletedId).toBe("gid://shopify/Order/1");
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("orderDelete"),
      { variables: { orderId: "gid://shopify/Order/1" } },
    );
  });
});
