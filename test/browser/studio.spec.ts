import { expect, test } from "@playwright/test";

test("Studio compiles TinySol and exposes deployment controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("TinySol Studio", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile/ })).toBeVisible();
  await page.getByRole("button", { name: /Compile/ }).click();
  await expect(page.getByText(/Build succeeded/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible();
});

test("mobile shows the supported desktop requirement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open Studio on a computer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to Explorer" })).toHaveAttribute("href", "http://127.0.0.1:4174");
});
