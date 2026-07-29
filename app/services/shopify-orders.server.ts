import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const ORDER_CREATE = `#graphql
  mutation KdcOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

export type ImportableOrder = {
  customerEmail?: string | null;
  currency: string;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  note?: string | null;
  tags: string[];
  processedAt?: Date | null;
  lineItems: { variantId: string | null; quantity: number }[];
};

export type CustomerVerificationProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
  defaultAddress?: string;
};

function formatMailingAddress(
  address?: {
    name?: string | null;
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
    phone?: string | null;
  } | null,
) {
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
                company
                address1
                address2
                city
                province
                zip
                country
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
            defaultAddress?: {
              name?: string | null;
              company?: string | null;
              address1?: string | null;
              address2?: string | null;
              city?: string | null;
              province?: string | null;
              zip?: string | null;
              country?: string | null;
              phone?: string | null;
            } | null;
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
    };
  } catch {
    return null;
  }
}

export async function findCustomerNamesByEmail(
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
  const customerNames = new Map<string, string>();

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
          }
        `,
      )
      .join("\n");

    try {
      const response = await admin.graphql(
        `query KdcCustomerNames(${variableDefinitions}) {
          ${selections}
        }`,
        { variables },
      );
      const json = (await response.json()) as {
        data?: Record<string, { displayName?: string } | null>;
      };

      batch.forEach((email, index) => {
        const displayName =
          json.data?.[`customer${index}`]?.displayName?.trim();
        if (displayName && displayName.toLowerCase() !== email) {
          customerNames.set(email, displayName);
        }
      });
    } catch {
      // Keep the pending-order preview available if customer enrichment fails.
    }
  }

  return customerNames;
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
  const response = await admin.graphql(ORDER_CREATE, {
    variables: {
      order: {
        customer: order.customerEmail
          ? { toUpsert: { email: order.customerEmail } }
          : undefined,
        currency: order.currency,
        financialStatus: financialStatus(order.financialStatus),
        fulfillmentStatus:
          order.fulfillmentStatus?.toUpperCase() === "FULFILLED"
            ? "FULFILLED"
            : undefined,
        processedAt: order.processedAt?.toISOString(),
        note: order.note || "Imported by KDC Order Importer",
        tags: order.tags,
        lineItems: order.lineItems.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
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
