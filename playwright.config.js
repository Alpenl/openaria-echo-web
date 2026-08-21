// @ts-check

import { defineConfig, devices } from "@playwright/test";

/**
 * 浏览器测试跑在真实构建产物上：fixture-server 服务 `dist/`，并以固定 fixture
 * 扮演 Device API v3。跑之前必须先 `npm run build`。
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "桌面", use: { viewport: { width: 1440, height: 960 } } },
    { name: "手机", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node tests/fixture-server.js",
    url: "http://127.0.0.1:4173/__ready",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
