import { expect, test, type Page } from "@playwright/test";
import { AbiCoder } from "ethers";

const configuredRpcUrl = new URL(process.env.VITE_RPC_URL || "https://ethereum-rpc.publicnode.com");
const isConfiguredRpc = (url: URL) => (
  url.origin === configuredRpcUrl.origin && url.pathname === configuredRpcUrl.pathname
);

async function installWallet(page: Page, initialChainId = "0x14a34") {
  await page.addInitScript((chainId) => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    let currentChainId = chainId;
    let currentAccounts = ["0x1111111111111111111111111111111111111111"];
    (window as unknown as { __walletEvent(name: string, value: unknown): void }).__walletEvent = (name, value) => {
      if (name === "accountsChanged") currentAccounts = value as string[];
      listeners[name]?.forEach((listener) => listener(value));
    };
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return currentChainId;
        if (method === "eth_requestAccounts" || method === "eth_accounts") return currentAccounts;
        if (method === "wallet_switchEthereumChain") {
          currentChainId = String((params as Array<{ chainId: string }>)[0]!.chainId);
          queueMicrotask(() => listeners.chainChanged?.forEach((listener) => listener(currentChainId)));
          return null;
        }
        throw new Error(`Unexpected wallet operation ${method}`);
      },
      on: (name, listener) => (listeners[name] ??= []).push(listener),
      removeListener: (name, listener) => {
        listeners[name] = (listeners[name] ?? []).filter((candidate) => candidate !== listener);
      }
    };
  }, initialChainId);
}

test("Studio compiles TinySol and exposes deployment controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Files", { exact: true })).toBeVisible();
  await expect(page.getByText("Studio", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Explorer/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Compile/ })).toBeVisible();
  await page.getByRole("button", { name: /Compile/ }).click();
  await expect(page.getByText(/Build succeeded/).first()).toBeVisible();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await expect(page.getByText("Package hash", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse console" }).click();
  await expect(page.getByRole("button", { name: "Expand console" })).toBeVisible();
  await page.getByRole("button", { name: "Deploy", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible();
});

test("Studio compiles TinySol 1.1 aggregate and bounded-value ABI in the browser", async ({ page }) => {
  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText("contract Modern { struct Pair { uint24 left; bool ok; } function echo(string<2> text, uint24[2] values, Pair pair) external view returns(string<2>) { return text; } }");
  await page.getByRole("button", { name: /Compile/ }).click();
  await expect(page.getByText("Compiled successfully", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Interact", exact: true }).first().click();
  await expect(page.locator(".function-card")).toContainText("echo(uint256,uint8,uint8,uint24,uint24,uint24,bool)");
  await expect(page.locator(".function-card")).toContainText("text.length");
  await expect(page.locator(".function-card")).toContainText("values[1]");
  await expect(page.locator(".function-card")).toContainText("pair.ok");
});

test("Studio creates and deletes workspace files and only exposes Counter as a template", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Counter", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Mini Token", { exact: true })).toHaveCount(0);
  await expect(page.getByText("sETH Bridge", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "New file" }).first().click();
  await expect(page.getByRole("button", { name: "Delete my-contract.tsol" })).toBeVisible();
  await page.getByRole("button", { name: "Delete my-contract.tsol" }).click();
  await expect(page.getByRole("button", { name: "Delete my-contract.tsol" })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete counter.tsol" }).click();
  await expect(page.locator(".studio-editor-empty").getByText("No file open", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile/ })).toBeDisabled();

  await page.getByRole("button", { name: "Counter State and return values" }).click();
  await expect(page.getByRole("button", { name: "Delete counter.tsol" })).toBeVisible();
  await expect(page.getByText("Compiled successfully", { exact: true })).toBeVisible();
});

test("Studio persists saved files and switching files does not overwrite or dirty them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New file" }).first().click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

  await page.locator(".studio-file-main").filter({ hasText: "counter.tsol" }).click();
  await expect(page.locator(".studio-file-row").filter({ hasText: "counter.tsol" })).not.toContainText("Unsaved");
  await page.reload();
  await expect(page.getByRole("button", { name: "Delete my-contract.tsol" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete counter.tsol" })).toBeVisible();
  await expect(page.locator(".editor-file-tab")).toContainText("counter.tsol");
});

test("workspace persistence keeps unsaved drafts marked as unsaved", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New file" }).first().click();
  await page.reload();
  await expect(page.locator(".studio-file-row").filter({ hasText: "my-contract.tsol" })).toContainText("Unsaved");
});

test("undo history cannot replace one file with another file's document", async ({ page }) => {
  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.goto("/");
  let editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText("contract FirstFile { function value() external view returns (uint256) { return 1; } }");
  await expect(editor).toContainText("FirstFile");

  await page.getByRole("button", { name: "New file" }).first().click();
  editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText("contract SecondFile { function value() external view returns (uint256) { return 2; } }");
  await page.locator(".studio-file-main").filter({ hasText: "counter.tsol" }).click();
  editor = page.locator(".cm-content");
  await expect(editor).toContainText("FirstFile");
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect(editor).toContainText("FirstFile");
  await expect(editor).not.toContainText("SecondFile");
});

test("Studio disconnects when the wallet account is removed", async ({ page }) => {
  await installWallet(page);
  await page.goto("/");
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true }).first();
  await connect.click();
  await expect(page.locator(".deploy-summary")).toContainText("0x1111…1111");
  await page.evaluate(() => (window as unknown as { __walletEvent(name: string, value: unknown): void }).__walletEvent("accountsChanged", []));
  await expect(connect).toBeVisible();
});

test("Studio detects an unsupported wallet network and offers a switch", async ({ page }) => {
  await installWallet(page, "0x1");
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();

  await expect(page.locator(".studio-network-warning")).toContainText("This network is not supported by Swaputer Studio.");
  await expect(page.getByRole("button", { name: `Switch to Ethereum Mainnet` })).toBeVisible();
  await page.getByRole("button", { name: `Switch to Ethereum Mainnet` }).click();

  await expect(page.locator(".studio-network-warning")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deploy contract", exact: true })).toBeVisible();
});

test("switching files discards a read that finishes for the previous source", async ({ page }) => {
  const abi = AbiCoder.defaultAbiCoder();
  const staticCallResult = abi.encode(["bytes", "uint32"], [abi.encode(["uint256"], [7n]), 19]);
  let releaseRpc!: () => void;
  let markRequested!: () => void;
  const released = new Promise<void>((resolve) => { releaseRpc = resolve; });
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  await page.route(isConfiguredRpc, async (route) => {
    markRequested();
    await released;
    const body = route.request().postDataJSON() as { id: number; jsonrpc: string };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: body.jsonrpc, id: body.id, result: staticCallResult }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Compile/ }).click();
  await expect(page.getByText(/Build succeeded/).first()).toBeVisible();
  await page.getByRole("button", { name: "Interact", exact: true }).first().click();
  await page.getByPlaceholder("0x…").fill(`0x${"12".repeat(32)}`);
  await page.locator(".function-card").filter({ hasText: "get()" }).getByRole("button", { name: "Call" }).click();
  await requested;
  await page.getByRole("button", { name: "New file" }).first().click();
  releaseRpc();

  await expect(page.getByText("get() called", { exact: true })).toHaveCount(0);
  await expect(page.locator(".editor-file-tab")).toContainText("my-contract.tsol");
});

test("changing the target discards stale reads and keeps every function locked until completion", async ({ page }) => {
  const abi = AbiCoder.defaultAbiCoder();
  const staticCallResult = abi.encode(["bytes", "uint32"], [abi.encode(["uint256"], [7n]), 19]);
  let releaseRpc!: () => void;
  let markRequested!: () => void;
  const released = new Promise<void>((resolve) => { releaseRpc = resolve; });
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  await page.route(isConfiguredRpc, async (route) => {
    markRequested();
    await released;
    const body = route.request().postDataJSON() as { id: number; jsonrpc: string };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: body.jsonrpc, id: body.id, result: staticCallResult }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Compile/ }).click();
  await expect(page.getByText(/Build succeeded/).first()).toBeVisible();
  await page.getByRole("button", { name: "Interact", exact: true }).first().click();
  const target = page.getByPlaceholder("0x…");
  const getCard = page.locator(".function-card").filter({ hasText: "get()" });
  const incrementCard = page.locator(".function-card").filter({ hasText: "increment()" });
  await target.fill(`0x${"12".repeat(32)}`);
  await getCard.getByRole("button", { name: "Call" }).click();
  await requested;
  await expect(incrementCard.getByRole("button", { name: "Send transaction" })).toBeDisabled();
  await target.fill(`0x${"34".repeat(32)}`);
  await expect(getCard.getByRole("button", { name: "Call" })).toBeDisabled();
  releaseRpc();

  await expect(getCard.getByRole("button", { name: "Call" })).toBeEnabled();
  await expect(getCard.locator("output")).toHaveCount(0);
  await expect(page.getByText("get() called", { exact: true })).toHaveCount(0);
});

test("mobile shows the supported desktop requirement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open Studio on a computer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to Explorer" })).toHaveAttribute("href", "http://127.0.0.1:4174");
});
