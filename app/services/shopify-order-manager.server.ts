import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { canonicalShopifyCdnImageUrl } from "./workbook.server";

type GraphqlError = {
  message?: string;
};

type UserError = {
  field?: string[] | null;
  message: string;
  code?: string | null;
};

export type Money = {
  amount: string;
  currencyCode: string;
};

export type ShopifyOrderAddress = {
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

export type ManagedOrderLine = {
  id: string;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  currentQuantity: number;
  unfulfilledQuantity: number;
  merchantEditable: boolean;
  imageUrl?: string | null;
  unitPrice: Money;
  variant?: {
    id: string;
    title: string;
    sku?: string | null;
    imageUrl?: string | null;
    product: { id: string; title: string };
  } | null;
};

export type ManagedShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  cancelledAt?: string | null;
  closedAt?: string | null;
  merchantEditable: boolean;
  merchantEditableErrors: string[];
  customer?: {
    id: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  shippingAddress?: ShopifyOrderAddress | null;
  billingAddress?: ShopifyOrderAddress | null;
  lineItems: ManagedOrderLine[];
  shippingLines: Array<{
    id: string;
    title: string;
    price: Money;
  }>;
  subtotal: Money;
  shippingTotal: Money;
  total: Money;
  outstanding: Money;
  preorderEta?: string | null;
  preorderPendingPrice?: string | null;
};

export type VariantSearchResult = {
  id: string;
  title: string;
  sku?: string | null;
  imageUrl?: string | null;
  price: string;
  product: { id: string; title: string };
};

const ORDER_LIST_QUERY = `#graphql
  query KdcManagedOrders(
    $first: Int!
    $after: String
    $query: String
  ) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: CREATED_AT
      reverse: true
    ) {
      nodes {
        id
        name
        createdAt
        updatedAt
        email
        displayFulfillmentStatus
        cancelledAt
        merchantEditable
        customer { displayName }
        currentTotalPriceSet {
          shopMoney { amount currencyCode }
        }
        lineItems(first: 1) {
          nodes {
            image { url }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDER_DETAIL_QUERY = `#graphql
  query KdcManagedOrder($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      updatedAt
      email
      phone
      note
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      closedAt
      merchantEditable
      merchantEditableErrors
      customer {
        id
        displayName
        email
        phone
      }
      shippingAddress {
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
      billingAddress {
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
      lineItems(first: 250) {
        nodes {
          id
          title
          variantTitle
          sku
          quantity
          currentQuantity
          unfulfilledQuantity
          merchantEditable
          image { url }
          discountedUnitPriceSet {
            shopMoney { amount currencyCode }
          }
          variant {
            id
            title
            sku
            image { url }
            product { id title }
          }
        }
      }
      shippingLines(first: 50) {
        nodes {
          id
          title
          currentDiscountedPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
      subtotalPriceSet {
        shopMoney { amount currencyCode }
      }
      totalShippingPriceSet {
        shopMoney { amount currencyCode }
      }
      currentTotalPriceSet {
        shopMoney { amount currencyCode }
      }
      totalOutstandingSet {
        shopMoney { amount currencyCode }
      }
      preorderEta: metafield(
        namespace: "custom"
        key: "preorder_eta"
      ) {
        value
      }
      preorderPendingPrice: metafield(
        namespace: "custom"
        key: "preorder_pending_price"
      ) {
        value
      }
    }
  }
`;

const VARIANT_SEARCH_QUERY = `#graphql
  query KdcManagedVariantSearch($query: String!) {
    productVariants(first: 25, query: $query, sortKey: RELEVANCE) {
      nodes {
        id
        title
        sku
        price
        image { url }
        product { id title }
      }
    }
  }
`;

function errorMessage(errors: Array<GraphqlError | UserError> | undefined) {
  return (
    errors
      ?.map((error) => error.message?.trim())
      .filter(Boolean)
      .join("; ") || null
  );
}

async function readGraphql<T>(
  response: Response,
  operationName: string,
): Promise<T> {
  const json = (await response.json()) as {
    data?: T;
    errors?: GraphqlError[];
  };
  const topLevelError = errorMessage(json.errors);
  if (topLevelError) {
    throw new Error(`${operationName}: ${topLevelError}`);
  }
  if (!json.data) {
    throw new Error(`${operationName}: Shopify returned no data.`);
  }
  return json.data;
}

function assertNoUserErrors(
  errors: UserError[] | undefined,
  operationName: string,
) {
  const message = errorMessage(errors);
  if (message) throw new Error(`${operationName}: ${message}`);
}

function shopMoney(value: { shopMoney: Money }): Money {
  return value.shopMoney;
}

export async function listManagedOrders(
  admin: AdminApiContext,
  options?: { after?: string | null; query?: string | null; first?: number },
) {
  const response = await admin.graphql(ORDER_LIST_QUERY, {
    variables: {
      first: Math.min(Math.max(options?.first ?? 50, 1), 100),
      after: options?.after || null,
      query: options?.query?.trim() || null,
    },
  });
  const data = await readGraphql<{
    orders: {
      nodes: Array<{
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
        email?: string | null;
        displayFulfillmentStatus: string;
        cancelledAt?: string | null;
        merchantEditable: boolean;
        customer?: { displayName: string } | null;
        currentTotalPriceSet: { shopMoney: Money };
        lineItems: { nodes: Array<{ image?: { url: string } | null }> };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(response as Response, "Load orders");

  return {
    orders: data.orders.nodes.map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      email: order.email ?? null,
      customerName: order.customer?.displayName ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus,
      cancelled: Boolean(order.cancelledAt),
      editable: order.merchantEditable,
      total: shopMoney(order.currentTotalPriceSet),
      imageUrl: order.lineItems.nodes[0]?.image?.url ?? null,
    })),
    pageInfo: data.orders.pageInfo,
  };
}

export async function getManagedOrder(
  admin: AdminApiContext,
  orderId: string,
): Promise<ManagedShopifyOrder | null> {
  const response = await admin.graphql(ORDER_DETAIL_QUERY, {
    variables: { id: orderId },
  });
  const data = await readGraphql<{
    order?: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      email?: string | null;
      phone?: string | null;
      note?: string | null;
      displayFinancialStatus: string;
      displayFulfillmentStatus: string;
      cancelledAt?: string | null;
      closedAt?: string | null;
      merchantEditable: boolean;
      merchantEditableErrors: string[];
      customer?: {
        id: string;
        displayName: string;
        email?: string | null;
        phone?: string | null;
      } | null;
      shippingAddress?: ShopifyOrderAddress | null;
      billingAddress?: ShopifyOrderAddress | null;
      lineItems: {
        nodes: Array<{
          id: string;
          title: string;
          variantTitle?: string | null;
          sku?: string | null;
          quantity: number;
          currentQuantity: number;
          unfulfilledQuantity: number;
          merchantEditable: boolean;
          image?: { url: string } | null;
          discountedUnitPriceSet: { shopMoney: Money };
          variant?: {
            id: string;
            title: string;
            sku?: string | null;
            image?: { url: string } | null;
            product: { id: string; title: string };
          } | null;
        }>;
      };
      shippingLines: {
        nodes: Array<{
          id: string;
          title: string;
          currentDiscountedPriceSet: { shopMoney: Money };
        }>;
      };
      subtotalPriceSet: { shopMoney: Money };
      totalShippingPriceSet: { shopMoney: Money };
      currentTotalPriceSet: { shopMoney: Money };
      totalOutstandingSet: { shopMoney: Money };
      preorderEta?: { value: string } | null;
      preorderPendingPrice?: { value: string } | null;
    } | null;
  }>(response as Response, "Load order");

  const order = data.order;
  if (!order) return null;
  return {
    ...order,
    lineItems: order.lineItems.nodes.map((line) => ({
      ...line,
      imageUrl: line.image?.url ?? line.variant?.image?.url ?? null,
      unitPrice: shopMoney(line.discountedUnitPriceSet),
      variant: line.variant
        ? {
            ...line.variant,
            imageUrl: line.variant.image?.url ?? null,
          }
        : null,
    })),
    shippingLines: order.shippingLines.nodes.map((line) => ({
      id: line.id,
      title: line.title,
      price: shopMoney(line.currentDiscountedPriceSet),
    })),
    subtotal: shopMoney(order.subtotalPriceSet),
    shippingTotal: shopMoney(order.totalShippingPriceSet),
    total: shopMoney(order.currentTotalPriceSet),
    outstanding: shopMoney(order.totalOutstandingSet),
    preorderEta: order.preorderEta?.value ?? null,
    preorderPendingPrice: order.preorderPendingPrice?.value ?? null,
  };
}

function escapeSearchTerm(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function searchManagedVariants(
  admin: AdminApiContext,
  search: string,
): Promise<VariantSearchResult[]> {
  const term = search.trim();
  if (!term) return [];

  const numericId = term.replace("gid://shopify/ProductVariant/", "").trim();
  const query = /^\d+$/.test(numericId)
    ? `id:${numericId}`
    : `"${escapeSearchTerm(term)}"`;
  const response = await admin.graphql(VARIANT_SEARCH_QUERY, {
    variables: { query },
  });
  const data = await readGraphql<{
    productVariants: {
      nodes: Array<{
        id: string;
        title: string;
        sku?: string | null;
        price: string;
        image?: { url: string } | null;
        product: { id: string; title: string };
      }>;
    };
  }>(response as Response, "Search variants");
  return data.productVariants.nodes.map((variant) => ({
    ...variant,
    imageUrl: variant.image?.url ?? null,
  }));
}

export type OrderContactUpdate = {
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  shippingAddress: ShopifyOrderAddress;
};

export async function updateManagedOrderContact(
  admin: AdminApiContext,
  orderId: string,
  update: OrderContactUpdate,
) {
  const shippingAddress = {
    firstName: update.shippingAddress.firstName,
    lastName: update.shippingAddress.lastName,
    company: update.shippingAddress.company,
    address1: update.shippingAddress.address1,
    address2: update.shippingAddress.address2,
    city: update.shippingAddress.city,
    provinceCode: update.shippingAddress.provinceCode,
    zip: update.shippingAddress.zip,
    countryCode:
      update.shippingAddress.countryCodeV2?.trim().toUpperCase() || undefined,
    phone: update.shippingAddress.phone,
  };
  const response = await admin.graphql(
    `#graphql
      mutation KdcManagedOrderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id name updatedAt }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          id: orderId,
          email: update.email?.trim() || null,
          phone: update.phone?.trim() || null,
          note: update.note?.trim() || null,
          shippingAddress: Object.fromEntries(
            Object.entries(shippingAddress)
              .map(([key, value]) => [
                key,
                typeof value === "string" ? value.trim() || null : value,
              ])
              .filter(([, value]) => value !== undefined),
          ),
        },
      },
    },
  );
  const data = await readGraphql<{
    orderUpdate: {
      order?: { id: string; name: string; updatedAt: string } | null;
      userErrors: UserError[];
    };
  }>(response as Response, "Update order");
  assertNoUserErrors(data.orderUpdate.userErrors, "Update order");
  if (!data.orderUpdate.order) {
    throw new Error("Update order: Shopify returned no updated order.");
  }
  return data.orderUpdate.order;
}

const PREORDER_METAFIELD_NAMESPACE = "custom";
const PREORDER_METAFIELD_DEFINITIONS = [
  {
    key: "preorder_eta",
    name: "Preorder ETA",
    type: "single_line_text_field",
    description:
      'ETA inserted into "Arriving {ETA}. Pay the remaining {amount} before dispatch."',
  },
  {
    key: "preorder_pending_price",
    name: "Preorder pending price",
    type: "number_decimal",
    description:
      "Remaining preorder amount the customer must pay before dispatch.",
  },
] as const;

async function ensurePreorderMetafieldDefinitions(admin: AdminApiContext) {
  const response = await admin.graphql(
    `#graphql
      query KdcPreorderMetafieldDefinitions {
        eta: metafieldDefinition(
          identifier: {
            ownerType: ORDER
            namespace: "custom"
            key: "preorder_eta"
          }
        ) {
          key
          type { name }
          access { customerAccount }
        }
        pendingPrice: metafieldDefinition(
          identifier: {
            ownerType: ORDER
            namespace: "custom"
            key: "preorder_pending_price"
          }
        ) {
          key
          type { name }
          access { customerAccount }
        }
      }
    `,
  );
  const data = await readGraphql<{
    eta?: {
      key: string;
      type: { name: string };
      access: { customerAccount: string };
    } | null;
    pendingPrice?: {
      key: string;
      type: { name: string };
      access: { customerAccount: string };
    } | null;
  }>(response as Response, "Load preorder field definitions");
  const current = new Map(
    [data.eta, data.pendingPrice]
      .filter(
        (
          definition,
        ): definition is {
          key: string;
          type: { name: string };
          access: { customerAccount: string };
        } => Boolean(definition),
      )
      .map((definition) => [definition.key, definition]),
  );

  for (const definition of PREORDER_METAFIELD_DEFINITIONS) {
    const existing = current.get(definition.key);
    if (existing && existing.type.name !== definition.type) {
      throw new Error(
        `Order metafield custom.${definition.key} must use type ${definition.type}.`,
      );
    }
    if (!existing) {
      const createResponse = await admin.graphql(
        `#graphql
          mutation KdcCreatePreorderMetafieldDefinition(
            $definition: MetafieldDefinitionInput!
          ) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id key }
              userErrors { field message code }
            }
          }
        `,
        {
          variables: {
            definition: {
              ownerType: "ORDER",
              namespace: PREORDER_METAFIELD_NAMESPACE,
              key: definition.key,
              name: definition.name,
              description: definition.description,
              type: definition.type,
              pin: true,
              access: {
                admin: "MERCHANT_READ_WRITE",
                customerAccount: "READ",
              },
            },
          },
        },
      );
      const createData = await readGraphql<{
        metafieldDefinitionCreate: {
          createdDefinition?: { id: string; key: string } | null;
          userErrors: UserError[];
        };
      }>(createResponse as Response, "Create preorder field definition");
      assertNoUserErrors(
        createData.metafieldDefinitionCreate.userErrors,
        "Create preorder field definition",
      );
      if (!createData.metafieldDefinitionCreate.createdDefinition) {
        throw new Error(
          "Create preorder field definition: Shopify returned no definition.",
        );
      }
      continue;
    }
    if (
      existing.access.customerAccount !== "READ" &&
      existing.access.customerAccount !== "READ_WRITE"
    ) {
      const updateResponse = await admin.graphql(
        `#graphql
          mutation KdcExposePreorderMetafieldDefinition(
            $definition: MetafieldDefinitionUpdateInput!
          ) {
            metafieldDefinitionUpdate(definition: $definition) {
              updatedDefinition { id key }
              userErrors { field message code }
            }
          }
        `,
        {
          variables: {
            definition: {
              ownerType: "ORDER",
              namespace: PREORDER_METAFIELD_NAMESPACE,
              key: definition.key,
              access: { customerAccount: "READ" },
            },
          },
        },
      );
      const updateData = await readGraphql<{
        metafieldDefinitionUpdate: {
          updatedDefinition?: { id: string; key: string } | null;
          userErrors: UserError[];
        };
      }>(updateResponse as Response, "Expose preorder field definition");
      assertNoUserErrors(
        updateData.metafieldDefinitionUpdate.userErrors,
        "Expose preorder field definition",
      );
    }
  }
}

export async function updateManagedOrderPreorder(
  admin: AdminApiContext,
  orderId: string,
  input: { eta: string; pendingPrice: string },
) {
  const eta = input.eta.trim();
  const pendingPriceText = input.pendingPrice.trim().replaceAll(",", "");
  if (!eta && !pendingPriceText) {
    const response = await admin.graphql(
      `#graphql
        mutation KdcClearManagedOrderPreorder(
          $metafields: [MetafieldIdentifierInput!]!
        ) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          metafields: PREORDER_METAFIELD_DEFINITIONS.map((definition) => ({
            ownerId: orderId,
            namespace: PREORDER_METAFIELD_NAMESPACE,
            key: definition.key,
          })),
        },
      },
    );
    const data = await readGraphql<{
      metafieldsDelete: { userErrors: UserError[] };
    }>(response as Response, "Clear preorder message");
    assertNoUserErrors(
      data.metafieldsDelete.userErrors,
      "Clear preorder message",
    );
    return;
  }
  if (!eta || !pendingPriceText) {
    throw new Error(
      "Enter both the preorder ETA and pending price, or clear both fields.",
    );
  }
  if (eta.length > 120) {
    throw new Error("Preorder ETA must be 120 characters or fewer.");
  }
  const pendingPrice = Number(pendingPriceText);
  if (!Number.isFinite(pendingPrice) || pendingPrice < 0) {
    throw new Error("Pending price must be zero or a positive amount.");
  }

  await ensurePreorderMetafieldDefinitions(admin);
  const response = await admin.graphql(
    `#graphql
      mutation KdcUpdateManagedOrderPreorder(
        $metafields: [MetafieldsSetInput!]!
      ) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key value }
          userErrors { field message code }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: orderId,
            namespace: PREORDER_METAFIELD_NAMESPACE,
            key: "preorder_eta",
            type: "single_line_text_field",
            value: eta,
          },
          {
            ownerId: orderId,
            namespace: PREORDER_METAFIELD_NAMESPACE,
            key: "preorder_pending_price",
            type: "number_decimal",
            value: pendingPrice.toFixed(2),
          },
        ],
      },
    },
  );
  const data = await readGraphql<{
    metafieldsSet: { userErrors: UserError[] };
  }>(response as Response, "Update preorder message");
  assertNoUserErrors(data.metafieldsSet.userErrors, "Update preorder message");
}

type CalculatedLine = {
  id: string;
  title: string;
  sku?: string | null;
  quantity: number;
  editableQuantity?: number;
  variant?: { id: string } | null;
};

async function beginOrderEdit(admin: AdminApiContext, orderId: string) {
  const response = await admin.graphql(
    `#graphql
      mutation KdcManagedOrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            originalOrder {
              lineItems(first: 250) {
                nodes {
                  id
                  title
                  sku
                  quantity
                  variant { id }
                }
              }
            }
            lineItems(first: 250) {
              nodes {
                id
                title
                sku
                quantity
                editableQuantity
                variant { id }
              }
            }
            shippingLines {
              id
              title
            }
          }
          userErrors { field message }
        }
      }
    `,
    { variables: { id: orderId } },
  );
  const data = await readGraphql<{
    orderEditBegin: {
      calculatedOrder?: {
        id: string;
        originalOrder: { lineItems: { nodes: CalculatedLine[] } };
        lineItems: { nodes: CalculatedLine[] };
        shippingLines: Array<{ id: string; title: string }>;
      } | null;
      userErrors: UserError[];
    };
  }>(response as Response, "Begin order edit");
  assertNoUserErrors(data.orderEditBegin.userErrors, "Begin order edit");
  if (!data.orderEditBegin.calculatedOrder) {
    throw new Error("Begin order edit: Shopify returned no edit session.");
  }
  return data.orderEditBegin.calculatedOrder;
}

async function commitOrderEdit(
  admin: AdminApiContext,
  calculatedOrderId: string,
  staffNote: string,
) {
  const response = await admin.graphql(
    `#graphql
      mutation KdcManagedOrderEditCommit(
        $id: ID!
        $staffNote: String
      ) {
        orderEditCommit(
          id: $id
          notifyCustomer: false
          staffNote: $staffNote
        ) {
          order { id name updatedAt }
          userErrors { field message }
        }
      }
    `,
    { variables: { id: calculatedOrderId, staffNote } },
  );
  const data = await readGraphql<{
    orderEditCommit: {
      order?: { id: string; name: string; updatedAt: string } | null;
      userErrors: UserError[];
    };
  }>(response as Response, "Commit order edit");
  assertNoUserErrors(data.orderEditCommit.userErrors, "Commit order edit");
  if (!data.orderEditCommit.order) {
    throw new Error("Commit order edit: Shopify returned no updated order.");
  }
  return data.orderEditCommit.order;
}

function sameLine(left: CalculatedLine, right: CalculatedLine) {
  return (
    left.variant?.id === right.variant?.id &&
    left.sku === right.sku &&
    left.title === right.title &&
    left.quantity === right.quantity
  );
}

async function getManagedLineEditability(
  admin: AdminApiContext,
  lineItemId: string,
) {
  const response = await admin.graphql(
    `#graphql
      query KdcManagedLineEditability($id: ID!) {
        node(id: $id) {
          ... on LineItem {
            id
            quantity
            currentQuantity
            unfulfilledQuantity
            merchantEditable
            variant { id }
          }
        }
      }
    `,
    { variables: { id: lineItemId } },
  );
  const data = await readGraphql<{
    node?: {
      id: string;
      quantity: number;
      currentQuantity: number;
      unfulfilledQuantity: number;
      merchantEditable: boolean;
      variant?: { id: string } | null;
    } | null;
  }>(response as Response, "Check line-item editability");
  return data.node ?? null;
}

function fulfilledLineError() {
  return new Error(
    "This product is already fulfilled, so Shopify must keep it in the order and fulfillment history. Cancel the fulfillment in Shopify first, then refresh this page before replacing or removing the product.",
  );
}

export async function editManagedOrderLine(
  admin: AdminApiContext,
  input: {
    orderId: string;
    lineItemId: string;
    quantity: number;
    replacementVariantId?: string | null;
    expectedImageUrl?: string | null;
    restock: boolean;
  },
) {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new Error("Quantity must be a whole number of zero or more.");
  }

  const replacementVariantId = input.replacementVariantId?.trim()
    ? normalizeVariantId(input.replacementVariantId)
    : null;
  if (replacementVariantId && input.quantity < 1) {
    throw new Error("A replacement variant needs a quantity of at least one.");
  }

  const currentLine = await getManagedLineEditability(admin, input.lineItemId);
  if (!currentLine) {
    throw new Error("The selected line item no longer exists on this order.");
  }
  const replacesVariant =
    replacementVariantId && replacementVariantId !== currentLine.variant?.id;
  const fullyUnfulfilled =
    currentLine.currentQuantity > 0 &&
    currentLine.unfulfilledQuantity === currentLine.quantity;
  if ((replacesVariant || input.quantity === 0) && !fullyUnfulfilled) {
    throw fulfilledLineError();
  }
  if (!currentLine.merchantEditable) {
    throw new Error(
      "Shopify marks this product as view-only, so it cannot be changed on this order.",
    );
  }
  const lockedQuantity = Math.max(
    0,
    currentLine.currentQuantity - currentLine.unfulfilledQuantity,
  );
  if (!replacesVariant && input.quantity < lockedQuantity) {
    throw fulfilledLineError();
  }

  if (replacementVariantId) {
    const variant = await getVariantForEdit(admin, replacementVariantId);
    if (!variant) {
      throw new Error("The replacement Shopify variant does not exist.");
    }
    const expectedImage = input.expectedImageUrl?.trim();
    if (expectedImage) {
      const expectedCanonical = canonicalShopifyCdnImageUrl(expectedImage);
      const actualCanonical = canonicalShopifyCdnImageUrl(
        variant.imageUrl ?? undefined,
      );
      if (!expectedCanonical) {
        throw new Error(
          'Expected image must start with "https://cdn.shopify.com/s/files/".',
        );
      }
      if (!actualCanonical || expectedCanonical !== actualCanonical) {
        throw new Error(
          "The expected image link is not assigned to the replacement variant.",
        );
      }
    }
  }

  const edit = await beginOrderEdit(admin, input.orderId);
  const originalIndex = edit.originalOrder.lineItems.nodes.findIndex(
    (line) => line.id === input.lineItemId,
  );
  if (originalIndex < 0) {
    throw new Error("The selected line item no longer exists on this order.");
  }
  const originalLine = edit.originalOrder.lineItems.nodes[originalIndex];
  const calculatedLine = edit.lineItems.nodes[originalIndex];
  if (!calculatedLine || !sameLine(originalLine, calculatedLine)) {
    throw new Error(
      "Shopify changed the line-item ordering. Refresh the order before editing.",
    );
  }

  if (
    (replacesVariant || input.quantity === 0) &&
    calculatedLine.editableQuantity !== calculatedLine.quantity
  ) {
    throw fulfilledLineError();
  }

  if (replacesVariant) {
    const addResponse = await admin.graphql(
      `#graphql
        mutation KdcManagedOrderAddVariant(
          $id: ID!
          $variantId: ID!
          $quantity: Int!
        ) {
          orderEditAddVariant(
            id: $id
            variantId: $variantId
            quantity: $quantity
            allowDuplicates: true
          ) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          id: edit.id,
          variantId: replacementVariantId,
          quantity: input.quantity,
        },
      },
    );
    const addData = await readGraphql<{
      orderEditAddVariant: {
        calculatedLineItem?: { id: string } | null;
        userErrors: UserError[];
      };
    }>(addResponse as Response, "Add replacement variant");
    assertNoUserErrors(
      addData.orderEditAddVariant.userErrors,
      "Add replacement variant",
    );
  }

  const setResponse = await admin.graphql(
    `#graphql
      mutation KdcManagedOrderSetQuantity(
        $id: ID!
        $lineItemId: ID!
        $quantity: Int!
        $restock: Boolean
      ) {
        orderEditSetQuantity(
          id: $id
          lineItemId: $lineItemId
          quantity: $quantity
          restock: $restock
        ) {
          calculatedLineItem { id quantity }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        id: edit.id,
        lineItemId: calculatedLine.id,
        quantity: replacesVariant ? 0 : input.quantity,
        restock: input.restock,
      },
    },
  );
  const setData = await readGraphql<{
    orderEditSetQuantity: {
      calculatedLineItem?: { id: string; quantity: number } | null;
      userErrors: UserError[];
    };
  }>(setResponse as Response, "Update line item");
  assertNoUserErrors(
    setData.orderEditSetQuantity.userErrors,
    "Update line item",
  );

  return commitOrderEdit(
    admin,
    edit.id,
    replacesVariant
      ? "Product variant replaced in KDC Order Importer"
      : input.quantity === 0
        ? "Line item removed in KDC Order Importer"
        : "Line item quantity updated in KDC Order Importer",
  );
}

export async function replaceManagedShippingCharge(
  admin: AdminApiContext,
  input: {
    orderId: string;
    title: string;
    amount: string;
    currencyCode: string;
  },
) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Shipping charge must be zero or a positive amount.");
  }
  const title = input.title.trim() || "Shipping";
  const edit = await beginOrderEdit(admin, input.orderId);

  for (const shippingLine of edit.shippingLines) {
    const response = await admin.graphql(
      `#graphql
        mutation KdcManagedOrderRemoveShipping(
          $id: ID!
          $shippingLineId: ID!
        ) {
          orderEditRemoveShippingLine(
            id: $id
            shippingLineId: $shippingLineId
          ) {
            userErrors { field message code }
          }
        }
      `,
      {
        variables: {
          id: edit.id,
          shippingLineId: shippingLine.id,
        },
      },
    );
    const data = await readGraphql<{
      orderEditRemoveShippingLine: { userErrors: UserError[] };
    }>(response as Response, "Remove existing shipping charge");
    assertNoUserErrors(
      data.orderEditRemoveShippingLine.userErrors,
      "Remove existing shipping charge",
    );
  }

  if (amount > 0) {
    const response = await admin.graphql(
      `#graphql
        mutation KdcManagedOrderAddShipping(
          $id: ID!
          $shippingLine: OrderEditAddShippingLineInput!
        ) {
          orderEditAddShippingLine(
            id: $id
            shippingLine: $shippingLine
          ) {
            calculatedShippingLine { id title }
            userErrors { field message code }
          }
        }
      `,
      {
        variables: {
          id: edit.id,
          shippingLine: {
            title,
            price: {
              amount: amount.toFixed(2),
              currencyCode: input.currencyCode,
            },
          },
        },
      },
    );
    const data = await readGraphql<{
      orderEditAddShippingLine: {
        calculatedShippingLine?: { id: string; title: string } | null;
        userErrors: UserError[];
      };
    }>(response as Response, "Add shipping charge");
    assertNoUserErrors(
      data.orderEditAddShippingLine.userErrors,
      "Add shipping charge",
    );
  }

  return commitOrderEdit(
    admin,
    edit.id,
    "Shipping charge updated in KDC Order Importer",
  );
}

function normalizeVariantId(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("gid://shopify/ProductVariant/")) return trimmed;
  if (/^\d+$/.test(trimmed)) {
    return `gid://shopify/ProductVariant/${trimmed}`;
  }
  throw new Error("Enter a valid Shopify variant ID.");
}

async function getVariantForEdit(
  admin: AdminApiContext,
  variantId: string,
): Promise<VariantSearchResult | null> {
  const response = await admin.graphql(
    `#graphql
      query KdcManagedVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          sku
          price
          image { url }
          product { id title }
        }
      }
    `,
    { variables: { id: variantId } },
  );
  const data = await readGraphql<{
    productVariant?: {
      id: string;
      title: string;
      sku?: string | null;
      price: string;
      image?: { url: string } | null;
      product: { id: string; title: string };
    } | null;
  }>(response as Response, "Verify replacement variant");
  return data.productVariant
    ? {
        ...data.productVariant,
        imageUrl: data.productVariant.image?.url ?? null,
      }
    : null;
}

export async function permanentlyDeleteManagedOrder(
  admin: AdminApiContext,
  input: { orderId: string; expectedOrderName: string; confirmation: string },
) {
  const expectedConfirmation = `DELETE ${input.expectedOrderName}`;
  if (input.confirmation.trim() !== expectedConfirmation) {
    throw new Error(`Type "${expectedConfirmation}" exactly to delete.`);
  }
  const response = await admin.graphql(
    `#graphql
      mutation KdcManagedOrderDelete($orderId: ID!) {
        orderDelete(orderId: $orderId) {
          deletedId
          userErrors { field message code }
        }
      }
    `,
    { variables: { orderId: input.orderId } },
  );
  const data = await readGraphql<{
    orderDelete: {
      deletedId?: string | null;
      userErrors: UserError[];
    };
  }>(response as Response, "Delete order");
  assertNoUserErrors(data.orderDelete.userErrors, "Delete order");
  if (data.orderDelete.deletedId !== input.orderId) {
    throw new Error("Delete order: Shopify did not confirm the deletion.");
  }
  return data.orderDelete.deletedId;
}
