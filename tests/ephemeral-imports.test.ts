import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedOrder } from "../app/lib/import-types";
import { createHistoricalOrder } from "../app/services/shopify-orders.server";
import { verifyOrderVariantImages } from "../app/services/variant-verification.server";
import {
  getSelectedReadyOrders,
  importReadyOrders,
  type EphemeralJob,
} from "../app/services/ephemeral-imports.server";

vi.mock("../app/services/shopify-orders.server", () => ({
  createHistoricalOrder: vi.fn(),
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
    vi.mocked(verifyOrderVariantImages).mockReset();
    vi.mocked(verifyOrderVariantImages).mockImplementation(
      async (_admin, orders) => orders,
    );
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
