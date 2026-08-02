import { describe, expect, it } from "vitest";
import { loader } from "../app/routes/healthz";

describe("health check", () => {
  it("returns a lightweight unauthenticated response", async () => {
    const response = loader();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
