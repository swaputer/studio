import { defineConfig } from "@playwright/test";

const testPort = 4276;

export default defineConfig({
  testDir: "./test/browser",
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}
  },
  webServer: {
    command: `npm run dev -- --port ${testPort}`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: false
  }
});
