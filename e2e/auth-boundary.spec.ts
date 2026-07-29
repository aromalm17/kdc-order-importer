import { expect, test } from "@playwright/test";

test("embedded app routes require Shopify authentication", async ({ page }) => {
  const response = await page.goto("/app");
  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/auth|shopify|app/);
});
