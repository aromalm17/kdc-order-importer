import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { ParsedOrder } from "../app/lib/import-types";
import {
  createHistoricalOrder,
  findCustomerProfilesByEmail,
} from "../app/services/shopify-orders.server";
import { verifyOrderVariantImages } from "../app/services/variant-verification.server";
import {
  applyCustomerShippingAddressValidation,
  clearEphemeralJob,
  clearEphemeralJobsForShop,
  createEphemeralJob,
  getCachedCustomerProfiles,
  getEphemeralJob,
  getSelectedReadyOrders,
  importReadyOrders,
  markOrdersUnfulfilled,
  pendingCsv,
  pendingWorkbook,
  type EphemeralJob,
} from "../app/services/ephemeral-imports.server";
import { hasBlockingIssues } from "../app/services/workbook.server";

vi.mock("../app/services/shopify-orders.server", () => ({
  createHistoricalOrder: vi.fn(),
  findCustomerProfilesByEmail: vi.fn(),
}));
vi.mock("../app/services/variant-verification.server", () => ({
  verifyOrderVariantImages: vi.fn(),
}));

function parsedOrder(key: string, blocked = false): ParsedOrder {
  return {
    sourceOrderId: key,
    deterministicKey: key,
    customerEmail: "buyer@example.com",
    currency: "INR",
    shippingCharge: 0,
    tags: [],
    lineItems: [],
    issues: blocked
      ? [
          {
            code: "MISSING_IMAGE",
            message: "Image is missing.",
            severity: "error",
          },
        ]
      : [],
  };
}

describe("Selective pending-order import", () => {
  beforeEach(() => {
    vi.mocked(createHistoricalOrder).mockReset();
    vi.mocked(findCustomerProfilesByEmail).mockReset();
    vi.mocked(findCustomerProfilesByEmail).mockResolvedValue(
      new Map([
        [
          "buyer@example.com",
          {
            email: "buyer@example.com",
            defaultAddress: "Pavithram, Kozhikode, Kerala, 673016, India",
            defaultShippingAddress: {
              address1: "Pavithram",
              city: "Kozhikode",
              provinceCode: "KL",
              zip: "673016",
              countryCode: "IN",
            },
          },
        ],
      ]),
    );
    vi.mocked(verifyOrderVariantImages).mockReset();
    vi.mocked(verifyOrderVariantImages).mockImplementation(
      async (_admin, orders) => orders,
    );
  });

  it("normalizes and reuses job-scoped customer profiles", async () => {
    const cachedProfile = {
      displayName: "Aromal M",
      email: "buyer@example.com",
      phone: "+919645260931",
      defaultAddress: "Pavithram, Kozhikode, Kerala, 673016, India",
      defaultShippingAddress: {
        address1: "Pavithram",
        city: "Kozhikode",
        countryCode: "IN",
      },
    };
    vi.mocked(findCustomerProfilesByEmail).mockResolvedValue(
      new Map([["buyer@example.com", cachedProfile]]),
    );
    const job = {
      updatedAt: new Date(0),
      customerProfiles: new Map(),
    } as EphemeralJob;

    const first = await getCachedCustomerProfiles(job, {} as never, [
      " Buyer@Example.com ",
      "buyer@example.com",
    ]);
    const second = await getCachedCustomerProfiles(job, {} as never, [
      "BUYER@example.com",
    ]);

    expect(findCustomerProfilesByEmail).toHaveBeenCalledTimes(1);
    expect(findCustomerProfilesByEmail).toHaveBeenCalledWith(
      expect.anything(),
      ["buyer@example.com"],
    );
    expect(first.get("buyer@example.com")).toEqual(cachedProfile);
    expect(second.get("buyer@example.com")).toEqual(cachedProfile);
    expect(job.customerProfiles.get("buyer@example.com")).toEqual(
      cachedProfile,
    );
    expect(job.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("fetches only profiles missing from the job cache", async () => {
    const existingProfile = {
      displayName: "Existing Customer",
      email: "existing@example.com",
      defaultAddress: "Existing address",
    };
    const newProfile = {
      displayName: "New Customer",
      email: "new@example.com",
      defaultAddress: "New address",
    };
    vi.mocked(findCustomerProfilesByEmail).mockResolvedValue(
      new Map([["new@example.com", newProfile]]),
    );
    const job = {
      updatedAt: new Date(),
      customerProfiles: new Map([["existing@example.com", existingProfile]]),
    } as EphemeralJob;

    const profiles = await getCachedCustomerProfiles(job, {} as never, [
      "existing@example.com",
      "new@example.com",
    ]);

    expect(findCustomerProfilesByEmail).toHaveBeenCalledWith(
      expect.anything(),
      ["new@example.com"],
    );
    expect(profiles.get("existing@example.com")).toEqual(existingProfile);
    expect(profiles.get("new@example.com")).toEqual(newProfile);
  });

  it("rechecks a missing default address after the customer is updated", async () => {
    vi.mocked(findCustomerProfilesByEmail)
      .mockResolvedValueOnce(
        new Map([
          [
            "buyer@example.com",
            {
              email: "buyer@example.com",
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "buyer@example.com",
            {
              email: "buyer@example.com",
              defaultShippingAddress: {
                address1: "Pavithram",
                city: "Kozhikode",
                countryCode: "IN",
              },
            },
          ],
        ]),
      );
    const job = {
      updatedAt: new Date(),
      customerProfiles: new Map(),
    } as EphemeralJob;

    const first = await getCachedCustomerProfiles(job, {} as never, [
      "buyer@example.com",
    ]);
    const second = await getCachedCustomerProfiles(job, {} as never, [
      "buyer@example.com",
    ]);

    expect(
      first.get("buyer@example.com")?.defaultShippingAddress,
    ).toBeUndefined();
    expect(second.get("buyer@example.com")?.defaultShippingAddress).toEqual({
      address1: "Pavithram",
      city: "Kozhikode",
      countryCode: "IN",
    });
    expect(findCustomerProfilesByEmail).toHaveBeenCalledTimes(2);
  });

  it("returns only selected, ready, unique pending orders", () => {
    const job = {
      pending: [
        parsedOrder("ready-1"),
        parsedOrder("ready-2"),
        parsedOrder("blocked", true),
      ],
    } as EphemeralJob;

    expect(
      getSelectedReadyOrders(job, [
        "ready-2",
        "blocked",
        "ready-2",
        "unknown",
      ]).map((order) => order.deterministicKey),
    ).toEqual(["ready-2"]);
  });

  it("trims submitted keys before matching pending orders", () => {
    const job = {
      pending: [parsedOrder("ready-1")],
    } as EphemeralJob;

    expect(
      getSelectedReadyOrders(job, ["  ready-1  "]).map(
        (order) => order.deterministicKey,
      ),
    ).toEqual(["ready-1"]);
  });

  it("returns no candidates when nothing is selected", () => {
    const job = {
      pending: [parsedOrder("ready-1")],
    } as EphemeralJob;

    expect(getSelectedReadyOrders(job, [])).toEqual([]);
  });

  it("blocks orders when the Shopify customer has no default shipping address", () => {
    const missingAddress = parsedOrder("missing-address");
    const missingCustomer = parsedOrder("missing-customer");
    missingCustomer.customerEmail = "unknown@example.com";
    const lookupFailed = parsedOrder("lookup-failed");
    lookupFailed.customerEmail = "retry@example.com";

    applyCustomerShippingAddressValidation(
      [missingAddress, missingCustomer, lookupFailed],
      new Map([
        [
          "buyer@example.com",
          {
            email: "buyer@example.com",
          },
        ],
        ["unknown@example.com", null],
      ]),
    );

    expect(missingAddress.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_CUSTOMER_DEFAULT_SHIPPING_ADDRESS",
        severity: "error",
      }),
    );
    expect(missingCustomer.issues).toContainEqual(
      expect.objectContaining({
        code: "SHOPIFY_CUSTOMER_NOT_FOUND",
        severity: "error",
      }),
    );
    expect(lookupFailed.issues).toContainEqual(
      expect.objectContaining({
        code: "CUSTOMER_SHIPPING_ADDRESS_LOOKUP_FAILED",
        severity: "error",
      }),
    );
    expect(hasBlockingIssues(missingAddress)).toBe(true);
    expect(hasBlockingIssues(missingCustomer)).toBe(true);
    expect(hasBlockingIssues(lookupFailed)).toBe(true);
  });

  it("clears the current temporary import and latest-shop reference", () => {
    const shop = "clear-import.example.myshopify.com";
    const job = createEphemeralJob(shop, "orders.xlsx", {
      sheetNames: ["Orders"],
      selectedSheet: "Orders",
      headers: [],
      totalRows: 1,
      mapping: {},
      orders: [parsedOrder("ready-1")],
    });

    expect(getEphemeralJob(shop, job.id)).toBe(job);
    expect(getEphemeralJob(shop)).toBe(job);
    expect(clearEphemeralJob(shop, job.id)).toBe(true);
    expect(getEphemeralJob(shop, job.id)).toBeUndefined();
    expect(getEphemeralJob(shop)).toBeUndefined();
    expect(clearEphemeralJob(shop, job.id)).toBe(false);
  });

  it("keeps only one active in-memory import per shop", () => {
    const shop = "single-job.example.myshopify.com";
    const first = createEphemeralJob(shop, "first.xlsx", {
      sheetNames: ["Orders"],
      selectedSheet: "Orders",
      headers: [],
      totalRows: 1,
      mapping: {},
      orders: [parsedOrder("first")],
    });
    const second = createEphemeralJob(shop, "second.xlsx", {
      sheetNames: ["Orders"],
      selectedSheet: "Orders",
      headers: [],
      totalRows: 1,
      mapping: {},
      orders: [parsedOrder("second")],
    });

    expect(getEphemeralJob(shop, first.id)).toBeUndefined();
    expect(getEphemeralJob(shop)).toBe(second);
    expect(clearEphemeralJobsForShop(shop)).toBe(1);
    expect(clearEphemeralJobsForShop(shop)).toBe(0);
  });

  it("marks pasted pending order numbers Unfulfilled in bulk", () => {
    const first = parsedOrder("key-1");
    first.sourceOrderId = "1674";
    first.sourceOrderName = "#1674";
    const second = parsedOrder("key-2");
    second.sourceOrderId = "1673";
    second.sourceOrderName = "#1673";
    const untouched = parsedOrder("key-3");
    untouched.sourceOrderName = "#1672";
    const job = {
      pending: [first, second, untouched],
      status: "PREVIEW",
      currentMessage: "Ready for review",
      updatedAt: new Date(0),
    } as EphemeralJob;

    const result = markOrdersUnfulfilled(job, "#1674, 1673\n#9999; #1674");

    expect(result).toEqual({
      requested: 3,
      marked: 2,
      notFound: ["#9999"],
    });
    expect(first.fulfillmentStatus).toBe("Unfulfilled");
    expect(second.fulfillmentStatus).toBe("Unfulfilled");
    expect(untouched.fulfillmentStatus).toBeUndefined();
    expect(first.issues).not.toContainEqual(
      expect.objectContaining({
        code: "INCOMPLETE_FULFILLMENT_STATUS",
      }),
    );
    expect(hasBlockingIssues(first)).toBe(false);
    expect(hasBlockingIssues(second)).toBe(false);
    expect(hasBlockingIssues(untouched)).toBe(false);
    expect(job.status).toBe("PENDING");
    expect(job.currentMessage).toBe(
      "2 orders marked Unfulfilled and ready for import",
    );
    expect(job.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("retains fulfillment status in the pending export", () => {
    const order = parsedOrder("incomplete", true);
    order.fulfillmentStatus = "Unfulfilled";
    order.lineItems = [
      {
        sourceRowNumber: 2,
        productTitle: "Car",
        quantity: 1,
        unitPrice: 949,
        rawRow: {},
        issues: [],
      },
    ];
    const csv = pendingCsv({ pending: [order] } as EphemeralJob);

    expect(csv).toContain('"Fulfillment Status"');
    expect(csv).toContain('"Unfulfilled"');
  });

  it("retains the order-level shipping charge in the pending export", () => {
    const order = parsedOrder("shipping", true);
    order.shippingCharge = 120;
    order.lineItems = [
      {
        sourceRowNumber: 2,
        productTitle: "Car",
        quantity: 1,
        unitPrice: 949,
        rawRow: {},
        issues: [],
      },
    ];

    const csv = pendingCsv({ pending: [order] } as EphemeralJob);

    expect(csv).toContain('"Shipping Charge"');
    expect(csv).toContain('"120"');
  });

  it("exports only not-ready orders to the pending workbook", async () => {
    const ready = parsedOrder("ready");
    ready.sourceOrderName = "#1001";
    ready.lineItems = [
      {
        sourceRowNumber: 2,
        productTitle: "Ready car",
        quantity: 1,
        unitPrice: 649,
        rawRow: {},
        issues: [],
      },
    ];
    const blocked = parsedOrder("blocked", true);
    blocked.sourceOrderName = "#1002";
    blocked.lineItems = [
      {
        sourceRowNumber: 3,
        productTitle: "Blocked car",
        quantity: 1,
        unitPrice: 949,
        rawRow: {},
        issues: [],
      },
    ];

    const buffer = await pendingWorkbook({
      pending: [ready, blocked],
    } as EphemeralJob);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.getWorksheet("Pending orders");

    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell("A2").value).toBe("#1002");
    expect(sheet?.getCell("G2").value).toBe("Blocked car");
  });

  it("imports and removes only the selected ready order", async () => {
    vi.mocked(createHistoricalOrder).mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
    });
    const first = parsedOrder("ready-1");
    const second = parsedOrder("ready-2");
    const job = {
      id: "job-1",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 2,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [first, second],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, ["ready-2"]);

    expect(createHistoricalOrder).toHaveBeenCalledTimes(1);
    expect(job.pending.map((order) => order.deterministicKey)).toEqual([
      "ready-1",
    ]);
    expect(job.importedOrders).toBe(1);
    expect(job.status).toBe("PENDING");
  });

  it("passes the Excel unit price to Shopify order creation", async () => {
    vi.mocked(createHistoricalOrder).mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
    });
    const order = parsedOrder("ready-with-excel-price");
    order.sourceOrderName = "#2660";
    order.lineItems = [
      {
        sourceRowNumber: 2,
        productTitle: "Car",
        variantId: "gid://shopify/ProductVariant/100",
        quantity: 2,
        unitPrice: 649,
        imageUrl: "https://cdn.shopify.com/s/files/1/car.jpg",
        rawRow: {},
        issues: [],
      },
    ];
    const job = {
      id: "job-price",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [order],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, [order.deterministicKey]);

    expect(createHistoricalOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "#2660",
        lineItems: [
          {
            title: "Car",
            variantId: "gid://shopify/ProductVariant/100",
            quantity: 2,
            unitPrice: 649,
          },
        ],
      }),
    );
  });

  it("passes the Excel shipping charge once at order level", async () => {
    vi.mocked(createHistoricalOrder).mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
    });
    const order = parsedOrder("ready-with-shipping");
    order.shippingCharge = 150;
    order.lineItems = [
      {
        sourceRowNumber: 2,
        productTitle: "Car",
        variantId: "gid://shopify/ProductVariant/100",
        quantity: 2,
        unitPrice: 649,
        imageUrl: "https://cdn.shopify.com/s/files/1/car.jpg",
        rawRow: {},
        issues: [],
      },
    ];
    const job = {
      id: "job-shipping",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [order],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, [order.deterministicKey]);

    expect(createHistoricalOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shippingCharge: 150 }),
    );
  });

  it("uses the matched customer's default address as imported shipping address", async () => {
    vi.mocked(createHistoricalOrder).mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
    });
    const order = parsedOrder("ready-with-address");
    order.customerEmail = " Buyer@Example.com ";
    const defaultShippingAddress = {
      firstName: "Aromal",
      lastName: "M",
      address1: "Pavithram",
      city: "Kozhikode",
      provinceCode: "KL",
      zip: "673016",
      countryCode: "IN",
      phone: "+919645260931",
    };
    vi.mocked(findCustomerProfilesByEmail).mockResolvedValue(
      new Map([
        [
          "buyer@example.com",
          {
            displayName: "Aromal M",
            email: "buyer@example.com",
            defaultAddress: "Pavithram, Kozhikode, Kerala, 673016, India",
            defaultShippingAddress,
          },
        ],
      ]),
    );
    const job = {
      id: "job-address",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [order],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, ["ready-with-address"]);

    expect(findCustomerProfilesByEmail).toHaveBeenCalledWith(
      expect.anything(),
      ["buyer@example.com"],
    );
    expect(createHistoricalOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerEmail: " Buyer@Example.com ",
        shippingAddress: defaultShippingAddress,
      }),
    );
    expect(job.pending).toEqual([]);
    expect(job.status).toBe("COMPLETED");
  });

  it("does not import when the matched customer has no default shipping address", async () => {
    const order = parsedOrder("missing-default-address");
    vi.mocked(findCustomerProfilesByEmail).mockResolvedValue(
      new Map([
        [
          "buyer@example.com",
          {
            email: "buyer@example.com",
          },
        ],
      ]),
    );
    const job = {
      id: "job-missing-address",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [order],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, [order.deterministicKey]);

    expect(createHistoricalOrder).not.toHaveBeenCalled();
    expect(order.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_CUSTOMER_DEFAULT_SHIPPING_ADDRESS",
      }),
    );
    expect(job.pending).toEqual([order]);
    expect(job.status).toBe("PENDING");
  });

  it("never imports a selected blocked order", async () => {
    const blocked = parsedOrder("blocked", true);
    const job = {
      id: "job-2",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [blocked],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, ["blocked"]);

    expect(createHistoricalOrder).not.toHaveBeenCalled();
    expect(job.pending).toEqual([blocked]);
    expect(job.importedOrders).toBe(0);
  });

  it("rechecks variant images immediately before import and skips a stale order", async () => {
    const order = parsedOrder("ready-before-image-change");
    vi.mocked(verifyOrderVariantImages).mockImplementationOnce(
      async (_admin, orders) => {
        orders[0].issues.push({
          code: "VARIANT_IMAGE_MISMATCH",
          message: "The assigned variant image changed.",
          severity: "error",
        });
        return orders;
      },
    );
    const job = {
      id: "job-3",
      shop: "example.myshopify.com",
      fileName: "orders.xlsx",
      createdAt: new Date(),
      updatedAt: new Date(),
      totalOrders: 1,
      importedOrders: 0,
      status: "PREVIEW",
      currentMessage: "Ready for review",
      pending: [order],
      customerProfiles: new Map(),
    } satisfies EphemeralJob;

    await importReadyOrders(job, {} as never, ["ready-before-image-change"]);

    expect(verifyOrderVariantImages).toHaveBeenCalledWith(expect.anything(), [
      order,
    ]);
    expect(createHistoricalOrder).not.toHaveBeenCalled();
    expect(job.pending).toEqual([order]);
    expect(job.status).toBe("PENDING");
    expect(job.currentMessage).toContain("blocked");
  });
});
