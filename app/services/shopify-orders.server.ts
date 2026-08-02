import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  isCompletedFulfillmentStatus,
  normalizeFulfillmentStatus,
} from "../lib/fulfillment-status";

const ORDER_CREATE = `#graphql
  mutation KdcOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

export type ImportableOrder = {
  name?: string | null;
  customerEmail?: string | null;
  shippingAddress?: ShopifyMailingAddressInput | null;
  currency: string;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  shippingCharge?: number | null;
  note?: string | null;
  tags: string[];
  processedAt?: Date | null;
  lineItems: {
    title?: string | null;
    variantId: string | null;
    quantity: number;
    unitPrice: number;
  }[];
};

export type ShopifyMailingAddressInput = {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  provinceCode?: string;
  zip?: string;
  countryCode?: string;
  phone?: string;
};

export type CustomerVerificationProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
  defaultAddress?: string;
  defaultShippingAddress?: ShopifyMailingAddressInput;
};

type CustomerDefaultAddress = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
};

function formatMailingAddress(address?: CustomerDefaultAddress | null) {
  if (!address) return undefined;
  const values = [
    address.name,
    address.company,
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
    address.phone,
  ].filter((value): value is string => Boolean(value));
  return values.length ? values.join(", ") : undefined;
}

function structuredMailingAddress(
  address?: CustomerDefaultAddress | null,
): ShopifyMailingAddressInput | undefined {
  if (!address) return undefined;
  const input = {
    firstName: address.firstName?.trim() || undefined,
    lastName: address.lastName?.trim() || undefined,
    company: address.company?.trim() || undefined,
    address1: address.address1?.trim() || undefined,
    address2: address.address2?.trim() || undefined,
    city: address.city?.trim() || undefined,
    provinceCode: address.provinceCode?.trim() || undefined,
    zip: address.zip?.trim() || undefined,
    countryCode: address.countryCodeV2?.trim() || undefined,
    phone: address.phone?.trim() || undefined,
  };
  return Object.values(input).some(Boolean) ? input : undefined;
}

export async function findCustomerByEmail(
  admin: AdminApiContext,
  email?: string,
): Promise<CustomerVerificationProfile | null> {
  if (!email) return null;
  try {
    const escaped = email.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const response = await admin.graphql(
      `#graphql
        query KdcCustomerVerification($query: String!) {
          customers(first: 1, query: $query) {
            nodes {
              displayName
              defaultEmailAddress { emailAddress }
              defaultPhoneNumber { phoneNumber }
              defaultAddress {
                name
                firstName
                lastName
                company
                address1
                address2
                city
                province
                provinceCode
                zip
                country
                countryCodeV2
                phone
              }
            }
          }
        }
      `,
      { variables: { query: `email:"${escaped}"` } },
    );
    const json = (await response.json()) as {
      data?: {
        customers?: {
          nodes?: Array<{
            displayName?: string;
            defaultEmailAddress?: { emailAddress?: string } | null;
            defaultPhoneNumber?: { phoneNumber?: string } | null;
            defaultAddress?: CustomerDefaultAddress | null;
          }>;
        };
      };
    };
    const customer = json.data?.customers?.nodes?.[0];
    if (!customer) return null;
    return {
      displayName: customer.displayName,
      email: customer.defaultEmailAddress?.emailAddress,
      phone: customer.defaultPhoneNumber?.phoneNumber,
      defaultAddress: formatMailingAddress(customer.defaultAddress),
      defaultShippingAddress: structuredMailingAddress(customer.defaultAddress),
    };
  } catch {
    return null;
  }
}

export async function findCustomerNamesByEmail(
  admin: AdminApiContext,
  emails: Array<string | undefined>,
) {
  const profiles = await findCustomerProfilesByEmail(admin, emails);
  const customerNames = new Map<string, string>();
  for (const [email, profile] of profiles) {
    const displayName = profile?.displayName?.trim();
    if (displayName && displayName.toLowerCase() !== email) {
      customerNames.set(email, displayName);
    }
  }
  return customerNames;
}

export async function findCustomerProfilesByEmail(
  admin: AdminApiContext,
  emails: Array<string | undefined>,
) {
  const uniqueEmails = [
    ...new Set(
      emails
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const customerProfiles = new Map<
    string,
    CustomerVerificationProfile | null
  >();

  for (let offset = 0; offset < uniqueEmails.length; offset += 50) {
    const batch = uniqueEmails.slice(offset, offset + 50);
    const variables = Object.fromEntries(
      batch.map((email, index) => [
        `identifier${index}`,
        { emailAddress: email },
      ]),
    );
    const variableDefinitions = batch
      .map((_, index) => `$identifier${index}: CustomerIdentifierInput!`)
      .join(", ");
    const selections = batch
      .map(
        (_, index) => `
          customer${index}: customerByIdentifier(identifier: $identifier${index}) {
            displayName
            defaultEmailAddress { emailAddress }
            defaultPhoneNumber { phoneNumber }
            defaultAddress {
              name
              firstName
              lastName
              company
              address1
              address2
              city
              province
              provinceCode
              zip
              country
              countryCodeV2
              phone
            }
          }
        `,
      )
      .join("\n");

    try {
      const response = await admin.graphql(
        `query KdcCustomerProfiles(${variableDefinitions}) {
          ${selections}
        }`,
        { variables },
      );
      const json = (await response.json()) as {
        data?: Record<
          string,
          {
            displayName?: string;
            defaultEmailAddress?: { emailAddress?: string } | null;
            defaultPhoneNumber?: { phoneNumber?: string } | null;
            defaultAddress?: CustomerDefaultAddress | null;
          } | null
        >;
      };

      batch.forEach((email, index) => {
        const customer = json.data?.[`customer${index}`];
        customerProfiles.set(
          email,
          customer
            ? {
                displayName: customer.displayName,
                email: customer.defaultEmailAddress?.emailAddress,
                phone: customer.defaultPhoneNumber?.phoneNumber,
                defaultAddress: formatMailingAddress(customer.defaultAddress),
                defaultShippingAddress: structuredMailingAddress(
                  customer.defaultAddress,
                ),
              }
            : null,
        );
      });
    } catch {
      // Keep the import preview available if customer enrichment fails.
    }
  }

  return customerProfiles;
}

function financialStatus(status?: string | null) {
  const value = status?.toUpperCase().replace(/\s+/g, "_");
  if (
    ["PAID", "PENDING", "AUTHORIZED", "REFUNDED", "VOIDED"].includes(
      value ?? "",
    )
  ) {
    return value;
  }
  return undefined;
}

export async function createHistoricalOrder(
  admin: AdminApiContext,
  order: ImportableOrder,
) {
  if (order.lineItems.some((line) => !line.variantId)) {
    throw new Error("Every line item must have a verified Shopify variant ID.");
  }
  if (
    order.lineItems.some(
      (line) => !Number.isFinite(line.unitPrice) || line.unitPrice < 0,
    )
  ) {
    throw new Error(
      "Every line item must have a valid zero or positive Excel price.",
    );
  }
  const shippingCharge = order.shippingCharge ?? 0;
  if (!Number.isFinite(shippingCharge) || shippingCharge < 0) {
    throw new Error(
      "Shipping Charge must be a valid zero or positive Excel amount.",
    );
  }
  const fulfillmentStatus = normalizeFulfillmentStatus(order.fulfillmentStatus);
  const isFulfilled = isCompletedFulfillmentStatus(fulfillmentStatus);
  if (!isFulfilled && fulfillmentStatus !== "Unfulfilled") {
    throw new Error(
      `Fulfillment Status is "${fulfillmentStatus}". Use Fulfilled or Unfulfilled before importing.`,
    );
  }
  if (
    !order.shippingAddress ||
    !Object.values(order.shippingAddress).some(
      (value) => typeof value === "string" && value.trim(),
    )
  ) {
    throw new Error(
      "A Shopify customer default shipping address is required before importing the order.",
    );
  }
  const response = await admin.graphql(ORDER_CREATE, {
    variables: {
      order: {
        name: order.name?.trim() || undefined,
        customer: order.customerEmail
          ? { toUpsert: { email: order.customerEmail } }
          : undefined,
        shippingAddress: order.shippingAddress ?? undefined,
        currency: order.currency,
        financialStatus: financialStatus(order.financialStatus),
        ...(isFulfilled ? { fulfillmentStatus: "FULFILLED" } : {}),
        processedAt: order.processedAt?.toISOString(),
        note: order.note || "Imported by KDC Order Importer",
        tags: order.tags,
        shippingLines:
          shippingCharge > 0
            ? [
                {
                  title: "Shipping",
                  priceSet: {
                    shopMoney: {
                      amount: shippingCharge,
                      currencyCode: order.currency,
                    },
                  },
                },
              ]
            : undefined,
        lineItems: order.lineItems.map((line) => ({
          title: line.title?.trim() || undefined,
          variantId: line.variantId,
          quantity: line.quantity,
          requiresShipping: true,
          priceSet: {
            shopMoney: {
              amount: line.unitPrice,
              currencyCode: order.currency,
            },
          },
        })),
      },
      options: {
        sendReceipt: false,
        sendFulfillmentReceipt: false,
      },
    },
  });
  const json = (await response.json()) as {
    errors?: unknown[];
    data?: {
      orderCreate?: {
        order?: { id: string; name: string };
        userErrors?: unknown[];
      };
    };
  };
  const payload = json.data?.orderCreate;
  if (json.errors?.length || payload?.userErrors?.length || !payload?.order) {
    throw new Error(
      JSON.stringify(
        json.errors ?? payload?.userErrors ?? ["Shopify returned no order."],
        null,
        2,
      ),
    );
  }
  return payload.order as { id: string; name: string };
}

export async function verifyVariants(
  admin: AdminApiContext,
  variantIds: string[],
) {
  const unique = [...new Set(variantIds.filter(Boolean))];
  const verified = new Map<string, VerifiedVariant>();
  if (!unique.length) return verified;

  for (let offset = 0; offset < unique.length; offset += 10) {
    const batch = unique.slice(offset, offset + 10);
    const response = await admin.graphql(
      `#graphql
        query KdcVerifyVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              product { title }
              media(first: 50) {
                nodes {
                  __typename
                  ... on MediaImage {
                    status
                    image { url }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `,
      {
        variables: {
          ids: batch.map((id) =>
            id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`,
          ),
        },
      },
    );
    const json = (await response.json()) as VariantNodesResponse;
    if (json.errors?.length || !json.data?.nodes) {
      throw new Error("Shopify could not verify the product variants.");
    }

    for (const node of json.data.nodes) {
      if (!node) continue;
      const numericId = node.id.replace("gid://shopify/ProductVariant/", "");
      const value: VerifiedVariant = {
        title: `${node.product.title} — ${node.title}`,
        imageUrls: [],
        hasUnreadyImage: false,
      };
      appendVariantMedia(value, node.media.nodes);
      verified.set(numericId, value);

      let cursor = node.media.pageInfo.endCursor;
      let hasNextPage = node.media.pageInfo.hasNextPage;
      while (hasNextPage) {
        if (!cursor) {
          throw new Error("Shopify returned incomplete variant media.");
        }
        const page = await loadVariantMediaPage(admin, node.id, cursor);
        appendVariantMedia(value, page.nodes);
        cursor = page.pageInfo.endCursor;
        hasNextPage = page.pageInfo.hasNextPage;
      }
    }
  }

  return verified;
}

export type VerifiedVariant = {
  title: string;
  imageUrls: string[];
  hasUnreadyImage: boolean;
};

type VariantMediaNode = {
  __typename: string;
  status?: string;
  image?: { url?: string } | null;
};

type VariantMediaConnection = {
  nodes: VariantMediaNode[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor?: string | null;
  };
};

type VariantNodesResponse = {
  errors?: unknown[];
  data?: {
    nodes?: Array<{
      id: string;
      title: string;
      product: { title: string };
      media: VariantMediaConnection;
    } | null>;
  };
};

function appendVariantMedia(
  variant: VerifiedVariant,
  media: VariantMediaNode[],
) {
  for (const item of media) {
    if (item.__typename !== "MediaImage") continue;
    const imageUrl = item.image?.url?.trim();
    if (item.status === "READY" && imageUrl) {
      if (!variant.imageUrls.includes(imageUrl))
        variant.imageUrls.push(imageUrl);
    } else {
      variant.hasUnreadyImage = true;
    }
  }
}

async function loadVariantMediaPage(
  admin: AdminApiContext,
  variantId: string,
  after?: string | null,
) {
  const response = await admin.graphql(
    `#graphql
      query KdcVerifyVariantMediaPage($id: ID!, $after: String) {
        node(id: $id) {
          ... on ProductVariant {
            media(first: 50, after: $after) {
              nodes {
                __typename
                ... on MediaImage {
                  status
                  image { url }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `,
    { variables: { id: variantId, after } },
  );
  const json = (await response.json()) as {
    errors?: unknown[];
    data?: {
      node?: {
        media?: VariantMediaConnection;
      } | null;
    };
  };
  if (json.errors?.length || !json.data?.node?.media) {
    throw new Error("Shopify could not finish verifying variant media.");
  }
  return json.data.node.media;
}
