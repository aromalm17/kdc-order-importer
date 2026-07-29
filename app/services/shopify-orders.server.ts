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

function formatMailingAddress(address?: {
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
} | null) {
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

function financialStatus(status?: string | null) {
  const value = status?.toUpperCase().replace(/\s+/g, "_");
  if (["PAID", "PENDING", "AUTHORIZED", "REFUNDED", "VOIDED"].includes(value ?? "")) {
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
  if (!unique.length) return new Map<string, { title: string; imageUrl?: string }>();
  const response = await admin.graphql(
    `#graphql
      query KdcVerifyVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            product { title featuredMedia { preview { image { url } } } }
            image { url }
          }
        }
      }
    `,
    {
      variables: {
        ids: unique.map((id) =>
          id.startsWith("gid://")
            ? id
            : `gid://shopify/ProductVariant/${id}`,
        ),
      },
    },
  );
  const json = (await response.json()) as {
    data?: {
      nodes?: Array<{
        id: string;
        title: string;
        image?: { url?: string };
        product: {
          title: string;
          featuredMedia?: { preview?: { image?: { url?: string } } };
        };
      } | null>;
    };
  };
  const map = new Map<string, { title: string; imageUrl?: string }>();
  for (const node of json.data?.nodes ?? []) {
    if (!node) continue;
    map.set(node.id.replace("gid://shopify/ProductVariant/", ""), {
      title: `${node.product.title} — ${node.title}`,
      imageUrl:
        node.image?.url ?? node.product.featuredMedia?.preview?.image?.url,
    });
  }
  return map;
}
