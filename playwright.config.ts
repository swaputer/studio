import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  use: {
    baseURL: "http://127.0.0.1:4176",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}
  },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4176", reuseExistingServer: !process.env.CI }
});
