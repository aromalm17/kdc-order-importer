import { describe, expect, it, vi } from "vitest";
import {
  createHistoricalOrder,
  findCustomerNamesByEmail,
  findCustomerProfilesByEmail,
  verifyVariants,
} from "../app/services/shopify-orders.server";

describe("Shopify order creation", () => {
  it("submits variant-backed line items and suppresses historical notifications", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          orderCreate: {
            order: { id: "gid://shopify/Order/1", name: "#1001" },
            userErrors: [],
          },
        },
      }),
    });
    const result = await createHistoricalOrder({ graphql } as never, {
      customerEmail: "buyer@example.com",
      shippingAddress: {
        firstName: "Aromal",
        lastName: "M",
        address1: "Pavithram",
        address2: "Kaloliparamba",
        city: "Kozhikode",
        provinceCode: "KL",
        zip: "673016",
        countryCode: "IN",
        phone: "+919645260931",
      },
      currency: "INR",
      financialStatus: "Paid",
      tags: ["KDC-Historical-Import"],
      lineItems: [
        { variantId: "gid://shopify/ProductVariant/100", quantity: 2 },
      ],
    });
    expect(result.name).toBe("#1001");
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("orderCreate"),
      expect.objectContaining({
        variables: expect.objectContaining({
          options: { sendReceipt: false, sendFulfillmentReceipt: false },
          order: expect.objectContaining({
            fulfillmentStatus: "FULFILLED",
            shippingAddress: {
              firstName: "Aromal",
              lastName: "M",
              address1: "Pavithram",
              address2: "Kaloliparamba",
              city: "Kozhikode",
              provinceCode: "KL",
              zip: "673016",
              countryCode: "IN",
              phone: "+919645260931",
            },
          }),
        }),
      }),
    );
  });

  it("refuses custom or unmapped line items before GraphQL", async () => {
    await expect(
      createHistoricalOrder({ graphql: vi.fn() } as never, {
        currency: "INR",
        tags: [],
        lineItems: [{ variantId: null, quantity: 1 }],
      }),
    ).rejects.toThrow("verified Shopify variant ID");
  });

  it.each(["Unfulfilled", "Awaiting shipment"])(
    "refuses an incomplete order before GraphQL: %s",
    async (fulfillmentStatus) => {
      const graphql = vi.fn();

      await expect(
        createHistoricalOrder({ graphql } as never, {
          currency: "INR",
          fulfillmentStatus,
          tags: [],
          lineItems: [
            {
              variantId: "gid://shopify/ProductVariant/100",
              quantity: 1,
            },
          ],
        }),
      ).rejects.toThrow("Only completed (Fulfilled) orders can be imported");

      expect(graphql).not.toHaveBeenCalled();
    },
  );

  it("resolves customer names for pending-order emails in one batch", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          customer0: { displayName: "Y B V Kaushik" },
          customer1: { displayName: "Roshan Pradeep" },
        },
      }),
    });

    const names = await findCustomerNamesByEmail({ graphql } as never, [
      "ybv@example.com",
      "roshan@example.com",
      "YBV@example.com",
    ]);

    expect(names.get("ybv@example.com")).toBe("Y B V Kaushik");
    expect(names.get("roshan@example.com")).toBe("Roshan Pradeep");
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("customerByIdentifier"),
      {
        variables: {
          identifier0: { emailAddress: "ybv@example.com" },
          identifier1: { emailAddress: "roshan@example.com" },
        },
      },
    );
  });

  it("resolves complete customer profiles and formats the default address", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          customer0: {
            displayName: "Aromal M",
            defaultEmailAddress: { emailAddress: "buyer@example.com" },
            defaultPhoneNumber: { phoneNumber: "+919645260931" },
            defaultAddress: {
              name: "Aromal M",
              firstName: "Aromal",
              lastName: "M",
              company: null,
              address1: "Pavithram",
              address2: "Kaloliparamba",
              city: "Kozhikode",
              province: "Kerala",
              provinceCode: "KL",
              zip: "673016",
              country: "India",
              countryCodeV2: "IN",
              phone: "+919645260931",
            },
          },
        },
      }),
    });

    const profiles = await findCustomerProfilesByEmail({ graphql } as never, [
      " Buyer@Example.com ",
      "buyer@example.com",
    ]);

    expect(profiles.get("buyer@example.com")).toEqual({
      displayName: "Aromal M",
      email: "buyer@example.com",
      phone: "+919645260931",
      defaultAddress:
        "Aromal M, Pavithram, Kaloliparamba, Kozhikode, Kerala, 673016, India, +919645260931",
      defaultShippingAddress: {
        firstName: "Aromal",
        lastName: "M",
        company: undefined,
        address1: "Pavithram",
        address2: "Kaloliparamba",
        city: "Kozhikode",
        provinceCode: "KL",
        zip: "673016",
        countryCode: "IN",
        phone: "+919645260931",
      },
    });
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql.mock.calls[0][1]).toEqual({
      variables: {
        identifier0: { emailAddress: "buyer@example.com" },
      },
    });
  });

  it("batches complete customer profile lookups in groups of 50", async () => {
    const graphql = vi
      .fn()
      .mockImplementation(
        async (
          _query: string,
          options: { variables: Record<string, { emailAddress: string }> },
        ) => ({
          json: async () => ({
            data: Object.fromEntries(
              Object.entries(options.variables).map(
                ([identifier, { emailAddress }]) => [
                  identifier.replace("identifier", "customer"),
                  {
                    displayName: `Customer ${emailAddress}`,
                    defaultEmailAddress: { emailAddress },
                  },
                ],
              ),
            ),
          }),
        }),
      );
    const emails = Array.from(
      { length: 51 },
      (_, index) => `customer-${index}@example.com`,
    );

    const profiles = await findCustomerProfilesByEmail(
      { graphql } as never,
      emails,
    );

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(Object.keys(graphql.mock.calls[0][1].variables)).toHaveLength(50);
    expect(Object.keys(graphql.mock.calls[1][1].variables)).toHaveLength(1);
    expect(profiles).toHaveLength(51);
    expect(profiles.get("customer-50@example.com")?.email).toBe(
      "customer-50@example.com",
    );
  });

  it("returns only images associated with the exact Shopify variant", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/100",
              title: "Black",
              product: { title: "Nissan Skyline R34" },
              media: {
                nodes: [
                  {
                    __typename: "MediaImage",
                    status: "READY",
                    image: {
                      url: "https://cdn.shopify.com/s/files/1/black.jpg?v=2",
                    },
                  },
                  {
                    __typename: "MediaImage",
                    status: "READY",
                    image: {
                      url: "https://cdn.shopify.com/s/files/1/black-side.jpg?v=3",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
        },
      }),
    });

    const variants = await verifyVariants({ graphql } as never, ["100"]);

    expect(variants.get("100")).toEqual({
      title: "Nissan Skyline R34 — Black",
      imageUrls: [
        "https://cdn.shopify.com/s/files/1/black.jpg?v=2",
        "https://cdn.shopify.com/s/files/1/black-side.jpg?v=3",
      ],
      hasUnreadyImage: false,
    });
    const query = graphql.mock.calls[0][0] as string;
    expect(query).toContain("media(first: 50)");
    expect(query).not.toContain("featuredMedia");
  });

  it("keeps an existing variant with no assigned image distinct from a missing variant", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/100",
              title: "Default Title",
              product: { title: "Car" },
              media: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
            null,
          ],
        },
      }),
    });

    const variants = await verifyVariants({ graphql } as never, ["100", "200"]);

    expect(variants.get("100")?.imageUrls).toEqual([]);
    expect(variants.has("200")).toBe(false);
  });

  it("loads every page of media assigned to a variant", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          data: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/100",
                title: "Silver",
                product: { title: "Car" },
                media: {
                  nodes: [
                    {
                      __typename: "MediaImage",
                      status: "READY",
                      image: {
                        url: "https://cdn.shopify.com/s/files/1/front.jpg",
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: {
            node: {
              media: {
                nodes: [
                  {
                    __typename: "MediaImage",
                    status: "READY",
                    image: {
                      url: "https://cdn.shopify.com/s/files/1/rear.jpg",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      });

    const variants = await verifyVariants({ graphql } as never, ["100"]);

    expect(variants.get("100")?.imageUrls).toHaveLength(2);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][1]).toEqual({
      variables: {
        id: "gid://shopify/ProductVariant/100",
        after: "cursor-1",
      },
    });
  });
});
