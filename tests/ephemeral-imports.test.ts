import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedOrder } from "../app/lib/import-types";
import {
  createHistoricalOrder,
  findCustomerProfilesByEmail,
} from "../app/services/shopify-orders.server";
import { verifyOrderVariantImages } from "../app/services/variant-verification.server";
import {
  getCachedCustomerProfiles,
  getSelectedReadyOrders,
  importReadyOrders,
  pendingCsv,
  type EphemeralJob,
} from "../app/services/ephemeral-imports.server";

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
    currency: "INR",
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
      customerProfiles: new Map([
        ["existing@example.com", existingProfile],
      ]),
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

  it("retains fulfillment status in the pending export", () => {
    const order = parsedOrder("incomplete");
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
