import { expect, test } from "@playwright/test";

test("golden shopper input does not repeat known budget, use case, or brand", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "A camera phone under ₹50,000" }).click();
  await expect(page.getByText("Anything you definitely need—or want to avoid?")).toBeVisible();
  await expect(page.getByText("What’s your maximum budget?")).toHaveCount(0);
  await expect(page.getByText("What will you use it for most?")).toHaveCount(0);
});

test("external buyer stops at an exact quote before checkout", async ({ page }) => {
  await page.goto("/agent-buyer");
  await page.getByRole("button", { name: "Find the best option" }).click();
  await expect(page.getByText("awaiting approval")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("heading", { name: "Nothing will be purchased yet." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this cart" })).toBeVisible();
  await expect(page.getByText("Your checkout is ready.")).toHaveCount(0);
});

test("evidence page labels synthetic results and exposes the policy", async ({ page }) => {
  await page.goto("/evidence");
  await expect(page.getByRole("heading", { name: "See how Choosy performs." })).toBeVisible();
  await expect(page.getByText("100 test shopping scenarios", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The shopper’s needs come first." })).toBeVisible();
});

test("inventory failure blocks Razorpay and can be restored", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "A camera phone under ₹50,000" }).click();
  await page.getByRole("button", { name: "No deal-breakers" }).click();
  await page.getByRole("button", { name: "Android", exact: true }).click();
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await page.getByRole("button", { name: "Choose this" }).first().click();
  await page.getByRole("button", { name: "Review this item" }).click();

  const merchant = await context.newPage();
  await merchant.goto("/merchant");
  await merchant.getByLabel("Access code").fill("admin");
  await merchant.getByRole("button", { name: "Sign in" }).click();
  await expect(merchant.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  await merchant.getByRole("button", { name: "Mark unavailable" }).click();
  await expect(merchant.getByText("Demo inventory change applied")).toBeVisible();

  await page.getByRole("button", { name: "Confirm this cart" }).click();
  await expect(page.getByText("Nothing was charged or substituted.", { exact: false })).toBeVisible();
  await merchant.reload();
  await merchant.getByRole("button", { name: "Restore stock" }).click();
});
