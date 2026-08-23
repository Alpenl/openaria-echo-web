// @ts-check

import { expect, test } from "@playwright/test";

/** @typedef {{path: string, idempotencyKey: string | null, body?: unknown}} FixtureRequestLog */
/** @typedef {{requests: number, inFlight: number, maxInFlight: number}} PreviewRouteMetrics */

const FOCUS_PEAKING_PREVIEW_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAQACADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+f+gD9Sv+Ccv/ACZp4N/7iP8A6cbmgD9kP+DfH/mrn/cA/wDcjQB+kVAH8AdAH6lf8E5f+TNPBv8A3Ef/AE43NAH7If8ABvj/AM1c/wC4B/7kaAP0ioA//9k=";

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

/**
 * 取景器优先的布局把会话台账和设备维护收进边缘面板：录制之外的东西不再挤压首屏。
 * 断言这些内容之前必须先打开对应面板——面板是布局，不是能力门禁。
 * @param {import("@playwright/test").Page} page
 * @param {"会话台账" | "设备与链路"} name
 */
async function openPanel(page, name) {
  const panel = page.getByRole("complementary", { name });
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} path
 */
async function fixtureRequestCount(request, path) {
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
  return body.requests.filter((entry) => entry.path === path).length;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} viewportName
 */
async function expectNoHorizontalOverflow(page, viewportName) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const panel = document.querySelector(".panel");
    const panelBody = document.querySelector(".panel-body");
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        if (element.closest(".frame") || element.closest(".visually-hidden")) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          (rect.left < -0.5 || rect.right > viewportWidth + 0.5)
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const className =
          typeof element.className === "string" ? element.className : element.tagName.toLowerCase();
        return {
          element: `${element.tagName.toLowerCase()}.${className}`,
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
        };
      });

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      panelClientWidth: panel?.clientWidth ?? null,
      panelScrollWidth: panel?.scrollWidth ?? null,
      panelBodyClientWidth: panelBody?.clientWidth ?? null,
      panelBodyScrollWidth: panelBody?.scrollWidth ?? null,
      offenders,
    };
  });

  expect(report.documentScrollWidth, `${viewportName}: document overflow`).toBeLessThanOrEqual(
    report.viewportWidth,
  );
  expect(report.bodyScrollWidth, `${viewportName}: body overflow`).toBeLessThanOrEqual(
    report.viewportWidth,
  );
  expect(report.panelScrollWidth, `${viewportName}: panel overflow`).toBe(
    report.panelClientWidth,
  );
  expect(report.panelBodyScrollWidth, `${viewportName}: panel body overflow`).toBe(
    report.panelBodyClientWidth,
  );
  expect(report.offenders, `${viewportName}: elements outside viewport`).toEqual([]);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{limit?: number, delayMs?: number}} [options]
 * @returns {Promise<PreviewRouteMetrics>}
 */
async function routeFocusPeakingPreview(page, options = {}) {
  const body = Buffer.from(FOCUS_PEAKING_PREVIEW_JPEG, "base64");
  const metrics = { requests: 0, inFlight: 0, maxInFlight: 0 };
  await page.route("**/api/v4/preview", async (route) => {
    metrics.requests += 1;
    metrics.inFlight += 1;
    metrics.maxInFlight = Math.max(metrics.maxInFlight, metrics.inFlight);
    try {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.limit && metrics.requests > options.limit) {
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            schema: "ylx.api-error.v2",
            error: {
              code: "preview_unavailable",
              message: "当前没有可用的预览帧",
              request_id: "5b778140-9b89-44ff-bc4d-f5b8df4f40ad",
              retryable: true,
            },
          }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "image/jpeg", body });
      }
    } finally {
      metrics.inFlight -= 1;
    }
  });
  return metrics;
}

/**
 * @param {import("@playwright/test").Page} page
 */
async function countFocusPeakingPixels(page) {
  return page.getByTestId("focus-peaking-canvas").evaluate((node) => {
    const canvas = /** @type {HTMLCanvasElement} */ (node);
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) {
      return 0;
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let highlighted = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 210 && pixels[index + 1] < 140 && pixels[index + 2] > 210) {
        highlighted += 1;
      }
    }
    return highlighted;
  });
}

test("设备工作台完全从同源离线加载", async ({ page }) => {
  /** @type {string[]} */
  const externalRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Open Aria Echo");
  await expect(page.getByRole("heading", { name: "Open Aria Echo" })).toBeAttached();
  expect(externalRequests).toEqual([]);
});

test("权威快照呈现设备、容量和真实 raw IMU", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("YLX-A1B2C3D4", { exact: true })).toBeVisible();
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByTestId("storage-available")).toHaveText("82.0 GiB");
  await expect(page.getByTestId("temperature")).toHaveText("43.5 °C");
  const rawImu = page.getByRole("region", { name: "RAW IMU" });
  await expect(rawImu).toBeVisible();
  await expect(rawImu.locator("dl > div")).toHaveCount(3);
  await expect(rawImu.locator("dl > :not(div)")).toHaveCount(0);
  await expect(page.getByTestId("acceleration")).toContainText("x 12.000");
  await expect(page.getByTestId("acceleration")).toContainText("raw");
  await expect(page.getByTestId("angular-velocity")).toContainText("x 1.000");
  await expect(page.getByTestId("angular-velocity")).toContainText("raw");
  await expect(page.getByTestId("imu-sync")).toHaveText("good");
});

test("未知 Device API major 失败关闭且不回退 v3 raw", async ({ page, request }) => {
  /** @type {string[]} */
  const pageApiPaths = [];
  page.on("request", (browserRequest) => {
    const path = new URL(browserRequest.url()).pathname;
    if (path.startsWith("/api/")) {
      pageApiPaths.push(path);
    }
  });
  await request.post("/__fixture/config", { data: { apiVersion: "5.0" } });

  await page.goto("/");

  await expect(page.locator(".connection")).toHaveText("连接中断");
  await expect(page.getByRole("alert")).toContainText("unsupported_device_api_major");
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
  const paths = body.requests.map((entry) => entry.path);
  expect(paths).toEqual(["/api/v4/device"]);
  expect(pageApiPaths).toEqual(["/api/v4/device"]);
  expect(paths).not.toContain("/api/v4/capture/status");
  expect(paths).not.toContain("/api/v4/sessions");
  expect(paths).not.toContain("/api/v4/network");
  expect(paths).not.toContain("/api/v4/network/events");
  expect(paths).not.toContain("/api/v4/capture/events");
  expect(paths).not.toContain("/api/v4/preview");
  expect(pageApiPaths.some((path) => path.startsWith("/api/v3/"))).toBe(false);
});

test("v4 state 事件触发一次权威刷新并保持事件流连接", async ({ page, request }) => {
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  const counts = async () => {
    const response = await request.get("/__fixture/requests");
    const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
    return {
      events: body.requests.filter((entry) => entry.path === "/api/v4/capture/events").length,
      statuses: body.requests.filter((entry) => entry.path === "/api/v4/capture/status").length,
    };
  };
  await expect.poll(async () => (await counts()).events).toBe(1);
  const before = await counts();

  await request.post("/__fixture/state-event", {
    data: { displayName: "state event refresh", valid: true },
  });

  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByText("state event refresh", { exact: true })).toBeVisible();
  await expect.poll(async () => (await counts()).statuses).toBeGreaterThan(before.statuses);
  const after = await counts();
  expect(after.events).toBe(before.events);
  expect(warnings).toEqual([]);
});

test("漏掉 SSE 事件时可见页面仍从权威状态自动收敛", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  await request.post("/__fixture/state", {
    data: { deviceState: "recording", displayName: "轮询对账录制", broadcast: false },
  });

  await expect(page.getByTestId("capture-state")).toHaveText("录制中", { timeout: 4000 });
  await expect(page.getByText("轮询对账录制", { exact: true })).toBeVisible();
});

test("v4 终态 state 事件把新封存会话同步到台账", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("终态事件封存");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");

  await request.post("/__fixture/terminal-state-event");

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await openPanel(page, "会话台账");
  await expect(
    page.getByTestId("session-item").filter({ hasText: "终态事件封存" }),
  ).toHaveCount(1);
});

test("无效 v4 state payload 不触发权威刷新", async ({ page, request }) => {
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  const counts = async () => {
    const response = await request.get("/__fixture/requests");
    const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
    return {
      events: body.requests.filter((entry) => entry.path === "/api/v4/capture/events").length,
      statuses: body.requests.filter((entry) => entry.path === "/api/v4/capture/status").length,
    };
  };
  await expect.poll(async () => (await counts()).events).toBe(1);
  const before = await counts();

  await request.post("/__fixture/state-event", {
    data: { displayName: "invalid state event should not refresh", valid: false },
  });
  await page.waitForTimeout(250);

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  const after = await counts();
  expect(after.events).toBe(before.events);
  expect(after.statuses).toBe(before.statuses);
  expect(warnings).toEqual([]);
});

test("设备未声明网络变更能力时仍读取只读网络状态和 mDNS", async ({ page, request }) => {
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });
  await request.post("/__fixture/config", {
    data: { networkMutation: false },
  });

  await page.goto("/");

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await openPanel(page, "设备与链路");
  await expect(page.getByTestId("network-mdns")).toHaveText("rp-ylx.local:8080");
  await expect(page.locator("#network-status")).toHaveText("未启用");
  await expect(page.getByRole("form", { name: "网络设置" })).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
      return body.requests.some((entry) => entry.path === "/api/v4/network/events");
    })
    .toBe(true);
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
  const paths = body.requests.map((entry) => entry.path);
  expect(paths).toContain("/api/v4/network");
  expect(paths).toContain("/api/v4/network/events");
  expect(warnings).toEqual([]);
});

test("慢会话清单不阻塞权威状态、事件流和录制准入", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { sessionsDelayMs: 10_000 } });

  await page.goto("/");

  await expect(page.getByText("YLX-A1B2C3D4", { exact: true })).toBeVisible();
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await expect(page.getByRole("button", { name: "开始录制" })).toBeEnabled();
  await openPanel(page, "会话台账");
  await expect(page.getByText("会话列表尚未加载", { exact: true })).toBeVisible();
});

test("网页可以调整相机焦距并同步到权威快照", async ({ page, request }) => {
  await page.goto("/");
  await openPanel(page, "设备与链路");

  await expect(page.getByTestId("camera-focus-value")).toHaveText("42");
  await expect(page.locator("#focus-status")).toContainText("手动焦距 42");

  await page.locator("#camera-focus-range").evaluate((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    input.value = "64";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByTestId("camera-focus-value")).toHaveText("64");
  await page.getByRole("button", { name: "应用焦距" }).click();

  await expect(page.getByTestId("camera-focus-value")).toHaveText("64");
  await expect(page.locator("#focus-status")).toContainText("手动焦距 64");

  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string, idempotencyKey: string | null}>}} */ (
    await response.json()
  );
  const focusRequests = body.requests.filter(
    (entry) => entry.path === "/api/v4/camera/focus" && entry.idempotencyKey,
  );
  expect(focusRequests).toHaveLength(1);
});

test("网页明确显示相机未暴露自动对焦控制", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { cameraFocusAutoSupported: false } });

  await page.goto("/");
  await openPanel(page, "设备与链路");

  await expect(page.locator("#camera-focus-auto")).toBeDisabled();
  await expect(page.locator("#focus-status")).toContainText("未暴露 V4L2 focus_auto");
});

test("峰值对焦默认启用并在预览边缘绘制高亮", async ({ page }) => {
  await routeFocusPeakingPreview(page);
  await page.goto("/");

  await expect(page.getByTestId("preview-image")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "峰值对焦" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("focus-peaking-canvas")).toBeAttached();
  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);
});

test("峰值对焦阈值会改变预览边缘高亮", async ({ page }) => {
  await routeFocusPeakingPreview(page);
  await page.goto("/");

  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);
  const initialPixels = await countFocusPeakingPixels(page);

  const threshold = page.getByLabel("峰值对焦阈值");
  await threshold.evaluate((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    input.value = "255";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect.poll(() => countFocusPeakingPixels(page)).toBeLessThan(initialPixels);
  expect(await countFocusPeakingPixels(page)).toBe(0);

  await threshold.evaluate((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    input.value = "24";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);
});

test("峰值对焦在后台暂停并在录制期间保持启用", async ({ page }) => {
  await routeFocusPeakingPreview(page);
  await page.goto("/");

  const toggle = page.getByRole("switch", { name: "峰值对焦" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await countFocusPeakingPixels(page)).toBe(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);

  await page.getByLabel("录制名称").fill("峰值对焦保持启用");
  await page.getByRole("button", { name: "开始录制" }).click();

  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toBeEnabled();
  await expect.poll(() => countFocusPeakingPixels(page)).toBeGreaterThan(0);
});

test("峰值对焦慢处理只保留最新预览帧", async ({ page }) => {
  await page.addInitScript(() => {
    const metrics = { decodeActive: 0, maxDecodeActive: 0, rendered: 0 };
    Object.defineProperty(window, "__focusPeakingMetrics", { value: metrics });
    const originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      metrics.decodeActive += 1;
      metrics.maxDecodeActive = Math.max(metrics.maxDecodeActive, metrics.decodeActive);
      await new Promise((resolve) => setTimeout(resolve, 140));
      try {
        return await originalDecode.call(this);
      } finally {
        metrics.decodeActive -= 1;
      }
    };
    const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      metrics.rendered += 1;
      return originalPutImageData.apply(this, args);
    };
  });
  const preview = await routeFocusPeakingPreview(page, { limit: 8 });
  await page.goto("/");

  await expect.poll(() => preview.requests).toBeGreaterThan(8);
  await page.waitForTimeout(260);
  const renderedAfterIdle = await page.evaluate(
    () => /** @type {any} */ (window).__focusPeakingMetrics.rendered,
  );
  await page.waitForTimeout(360);
  const metrics = await page.evaluate(() => /** @type {any} */ (window).__focusPeakingMetrics);

  expect(metrics.maxDecodeActive).toBe(1);
  expect(metrics.rendered).toBe(renderedAfterIdle);
  expect(metrics.rendered).toBeLessThan(preview.requests);
  expect(preview.maxInFlight).toBe(1);
});

test("v4 网络状态和事件在变更禁用时保持只读", async ({ page, request }) => {
  await page.goto("/");
  await openPanel(page, "设备与链路");

  await expect(page.getByTestId("network-wifi")).toContainText("未启用");
  await expect(page.getByTestId("network-modes")).toContainText("设备热点");
  await expect(page.getByTestId("network-desired")).toContainText("设备热点");
  await expect(page.getByTestId("network-transaction")).toContainText("无网络事务");
  await expect(page.getByTestId("network-mutation")).toContainText("未启用");
  await expect(page.getByTestId("network-mutation")).toContainText("apply / retry / forget");
  await expect(page.getByTestId("network-concurrency")).toContainText("未验证");
  await expect(page.locator("#network-status")).toHaveText("未启用");
  await expect(page.getByLabel("SSID")).toHaveCount(0);
  await expect(page.getByLabel("密码")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /应用网络|确认应用网络/ })).toHaveCount(0);

  await request.post("/__fixture/network-snapshot", {
    data: {
      defaultRoute: "wifi_client",
      wifiState: "connected",
      wifiSsid: "Lab WiFi",
      wifiAddress: "192.168.50.24/24",
    },
  });
  await expect(page.getByTestId("network-default-route")).toHaveText("Wi-Fi");
  await expect(page.getByTestId("network-wifi")).toContainText("Lab WiFi");
  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
      return body.requests.some((entry) => entry.path === "/api/v4/network/events");
    })
    .toBe(true);

  const beforeTransactionResponse = await request.get("/__fixture/requests");
  const beforeTransactionBody = /** @type {{requests: FixtureRequestLog[]}} */ (
    await beforeTransactionResponse.json()
  );
  const networkGetsBeforeTransaction = beforeTransactionBody.requests.filter(
    (entry) => entry.path === "/api/v4/network" && !entry.idempotencyKey,
  ).length;

  await request.post("/__fixture/network-transaction-event", {
    data: {
      operation: "apply",
      status: "rescued",
      stage: "rescued",
    },
  });
  await expect(page.getByTestId("network-transaction")).toContainText(
    "apply / rescued / rescued",
  );
  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
      return body.requests.filter(
        (entry) => entry.path === "/api/v4/network" && !entry.idempotencyKey,
      ).length;
    })
    .toBeGreaterThan(networkGetsBeforeTransaction);

  const response = await request.get("/__fixture/requests");
  /** @type {{requests: FixtureRequestLog[]}} */
  const body = await response.json();
  const networkMutationRequests = body.requests.filter(
    (entry) => entry.path.startsWith("/api/v4/network") && entry.idempotencyKey,
  );
  expect(body.requests.map((entry) => entry.path)).toContain("/api/v4/network/events");
  expect(networkMutationRequests).toHaveLength(0);
});

test("首次打开网络面板自动扫描一次且重开不重复", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { networkMutation: true } });
  await page.goto("/");

  const deviceTrigger = page.getByRole("button", { name: "设备与链路", exact: true });
  await expect.poll(() => fixtureRequestCount(request, "/api/v4/network/scan")).toBe(0);
  await deviceTrigger.click();

  const panel = page.getByRole("complementary", { name: "设备与链路" });
  const networkSelect = panel.getByLabel("Wi-Fi 网络");
  await expect(networkSelect.locator("option")).toHaveCount(3);
  await expect.poll(() => fixtureRequestCount(request, "/api/v4/network/scan")).toBe(1);

  await panel.getByRole("button", { name: "关闭" }).click();
  await expect(deviceTrigger).toBeFocused();
  await deviceTrigger.click();
  await expect(networkSelect.locator("option")).toHaveCount(3);
  await page.waitForTimeout(150);
  expect(await fixtureRequestCount(request, "/api/v4/network/scan")).toBe(1);

  await panel.getByRole("button", { name: "扫描 Wi-Fi" }).click();
  await expect.poll(() => fixtureRequestCount(request, "/api/v4/network/scan")).toBe(2);
});

test("受保护 Wi-Fi 通过一次性凭证完成应用、重试和忘记", async ({ page, request }) => {
  const sentinel = "fixture-passphrase-never-persist";
  await request.post("/__fixture/config", { data: { networkMutation: true } });
  await page.goto("/");
  await openPanel(page, "设备与链路");

  await expect(page.locator("#network-status")).toHaveText("网络变更可用");
  const networkSelect = page.getByLabel("Wi-Fi 网络");
  await expect(networkSelect.locator("option")).toHaveCount(3);
  await networkSelect.selectOption({ index: 1 });

  const passphrase = page.getByLabel("Wi-Fi 密码");
  await passphrase.fill(sentinel);
  const applyTrigger = page
    .getByRole("form", { name: "网络设置" })
    .locator('button[type="submit"]');
  await applyTrigger.click();
  const applyDialog = page.getByRole("alertdialog", { name: /切换到 Lab WiFi/ });
  await expect(applyDialog).toBeVisible();
  const applyCancel = applyDialog.getByRole("button", { name: "取消" });
  await expect(applyCancel).toBeFocused();
  await applyCancel.click();
  await expect(applyDialog).toHaveCount(0);
  await expect(applyTrigger).toBeFocused();

  await applyTrigger.click();
  await expect(applyCancel).toBeFocused();
  await applyDialog.getByRole("button", { name: "确认切换" }).click();
  await expect(applyTrigger).toBeFocused();
  await expect(passphrase).toHaveValue("");
  await expect(page.getByTestId("network-transaction")).toContainText("apply / accepted");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
      return body.requests.filter((entry) =>
        ["/api/v4/network/credentials", "/api/v4/network/apply"].includes(entry.path),
      ).length;
    })
    .toBe(2);

  let response = await request.get("/__fixture/requests");
  let body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
  const credentialRequest = body.requests.find(
    (entry) => entry.path === "/api/v4/network/credentials",
  );
  const applyRequest = body.requests.find((entry) => entry.path === "/api/v4/network/apply");
  expect(credentialRequest?.idempotencyKey).toBeNull();
  expect(applyRequest?.idempotencyKey).toBeTruthy();
  expect(JSON.stringify(body.requests)).not.toContain(sentinel);
  expect(JSON.stringify(body.requests)).not.toContain("cred-fixture-");
  expect(JSON.stringify(credentialRequest?.body)).toContain("<redacted>");
  expect(JSON.stringify(applyRequest?.body)).toContain("<redacted>");

  await request.post("/__fixture/network-transaction-event", {
    data: { status: "rescued", stage: "rescued" },
  });
  await expect(page.getByTestId("network-transaction")).toContainText("apply / rescued / rescued");
  const retry = page.getByRole("button", { name: "重试事务" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByTestId("network-transaction")).toContainText("retry / accepted");

  await request.post("/__fixture/network-transaction-event", {
    data: { status: "committed", stage: "committed" },
  });
  await expect(page.getByTestId("network-transaction")).toContainText(
    "retry / committed / committed",
  );
  await expect(page.locator("#network-status")).toHaveText("已保存并验证当前 Wi-Fi");

  const forgetTrigger = page.getByRole("button", { name: "忘记 Wi-Fi" });
  await forgetTrigger.click();
  const forgetDialog = page.getByRole("alertdialog", { name: "忘记已保存的 Wi-Fi" });
  await expect(forgetDialog).toBeVisible();
  const forgetCancel = forgetDialog.getByRole("button", { name: "取消" });
  await expect(forgetCancel).toBeFocused();
  await forgetCancel.click();
  await expect(forgetDialog).toHaveCount(0);
  await expect(forgetTrigger).toBeFocused();

  await forgetTrigger.click();
  await expect(forgetCancel).toBeFocused();
  await forgetDialog.getByRole("button", { name: "确认忘记" }).click();
  await expect(page.getByRole("button", { name: "正在忘记" })).toBeFocused();

  await expect
    .poll(async () => {
      response = await request.get("/__fixture/requests");
      body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
      return body.requests.filter((entry) => entry.path === "/api/v4/network/forget").length;
    })
    .toBe(1);
});

test("开放 Wi-Fi 应用不创建凭证引用", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { networkMutation: true } });
  await page.goto("/");
  await openPanel(page, "设备与链路");
  const networkSelect = page.getByLabel("Wi-Fi 网络");
  await expect(networkSelect.locator("option")).toHaveCount(3);
  await networkSelect.selectOption({ index: 2 });
  await expect(page.getByLabel("Wi-Fi 密码")).toHaveCount(0);
  await page.getByRole("button", { name: "应用网络" }).click();
  await page
    .getByRole("alertdialog", { name: /切换到 Open Lab/ })
    .getByRole("button", { name: "确认切换" })
    .click();

  await expect(page.getByTestId("network-transaction")).toContainText("apply / accepted");
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: FixtureRequestLog[]}} */ (await response.json());
  expect(
    body.requests.filter((entry) => entry.path === "/api/v4/network/credentials"),
  ).toHaveLength(0);
  expect(body.requests.filter((entry) => entry.path === "/api/v4/network/apply")).toHaveLength(1);
});

test("320、360 和手机横屏下网络确认流程无水平溢出", async ({ page, request }, testInfo) => {
  const viewports = [
    { name: "320-portrait", width: 320, height: 568 },
    { name: "360-portrait", width: 360, height: 640 },
    { name: "phone-landscape", width: 667, height: 375 },
  ];
  await request.post("/__fixture/config", { data: { networkMutation: true } });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const panel = await openPanel(page, "设备与链路");
    const networkSelect = panel.getByLabel("Wi-Fi 网络");
    await expect(networkSelect.locator("option")).toHaveCount(3);
    await networkSelect.selectOption({ index: 1 });
    await panel.getByLabel("Wi-Fi 密码").fill("layout-passphrase");
    await panel.getByRole("button", { name: "应用网络" }).click();
    const dialog = panel.getByRole("alertdialog", { name: /切换到 Lab WiFi/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();

    await expectNoHorizontalOverflow(page, viewport.name);
    await page.screenshot({
      path: testInfo.outputPath(`network-${viewport.name}.png`),
      animations: "disabled",
    });
  }
});

test("fixture 请求日志会脱敏网络 secret 字段", async ({ request }) => {
  const sentinel = "sentinel-psk-never-log";
  await request.post("/api/v4/network/apply", {
    data: {
      schema: "ylx.network-apply-request.v1",
      desired: {
        mode: "wifi-client",
        wifi_client: {
          ssid: "Lab WiFi",
          credential_ref: "opaque:lab-wifi",
        },
        ethernet: null,
      },
      nested: { password: sentinel, token: sentinel, secret: sentinel },
    },
    headers: { "Idempotency-Key": "fixture-redaction" },
  });

  const response = await request.get("/__fixture/requests");
  /** @type {{requests: FixtureRequestLog[]}} */
  const body = await response.json();
  const serialized = JSON.stringify(body.requests);
  expect(serialized).not.toContain(sentinel);
  expect(serialized).toContain("<redacted>");
});

test("无录制卷时设备保持在线并显示空会话列表", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { sessionsVolumeUnavailable: true } });

  await page.goto("/");

  await expect(page.locator(".connection")).toHaveText("已连接");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByTestId("storage-available")).toHaveText("0.0 GiB");
  await expect(page.getByTestId("storage-writable")).toHaveText("不可写");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始录制" })).toBeDisabled();
  await openPanel(page, "会话台账");
  await expect(page.getByText("暂无会话", { exact: true })).toBeVisible();
});

test("录制命令在权威快照到达前保持待机", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { commandDelayMs: 350 } });
  await page.goto("/");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  await page.getByLabel("录制名称").fill("走廊采集 01");
  await page.getByRole("button", { name: "开始录制" }).click();

  await expect(page.getByRole("button", { name: "正在发送" })).toBeDisabled();
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByText("走廊采集 01", { exact: true })).toBeVisible();
});

test("缺少 crypto.randomUUID 的 HTTP LAN 浏览器仍能发送录制命令", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await page.getByLabel("录制名称").fill("无 randomUUID 兼容");

  await page.getByRole("button", { name: "开始录制" }).click();

  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string, idempotencyKey: string | null}>}} */ (
    await response.json()
  );
  const starts = body.requests.filter((entry) => entry.path === "/api/v4/capture/start");
  expect(starts).toHaveLength(1);
  expect(starts[0].idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("录制命令只在本次请求结束后解锁", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { commandDelayMs: 350 } });
  await page.goto("/");
  await page.getByLabel("录制名称").fill("单次提交");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByRole("button", { name: "正在发送" })).toBeDisabled();

  await request.post("/__fixture/state", { data: { broadcast: true } });
  await expect(page.getByRole("button", { name: "正在发送" })).toBeDisabled();

  const pendingResponse = await request.get("/__fixture/requests");
  const pendingRequests = /** @type {{requests: Array<{path: string}>}} */ (
    await pendingResponse.json()
  ).requests;
  expect(
    pendingRequests.filter((entry) => entry.path === "/api/v4/capture/start"),
  ).toHaveLength(1);

  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByRole("button", { name: "结束录制" })).toBeEnabled();
});

test("customer 事件流携带令牌并在断线后从权威快照收敛", async ({ page, request }) => {
  /** @type {import("@playwright/test").Request[]} */
  const pageEventRequests = [];
  page.on("request", (browserRequest) => {
    if (new URL(browserRequest.url()).pathname === "/api/v4/capture/events") {
      pageEventRequests.push(browserRequest);
    }
  });
  await request.post("/__fixture/config", { data: { requireBearer: true } });
  await page.addInitScript(() => {
    sessionStorage.setItem("rp-ylx-access-token", "customer-token");
  });
  await page.goto("/");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
      return body.requests.filter((entry) => entry.path === "/api/v4/capture/events").length;
    })
    .toBe(1);

  await request.post("/__fixture/state", {
    data: { deviceState: "recording", displayName: "另一台手机发起", broadcast: false },
  });
  await request.post("/__fixture/disconnect-events");

  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByText("另一台手机发起", { exact: true })).toBeVisible();

  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string, authorization: string | null, lastEventId: string | null}>}} */ (
    await response.json()
  );
  const events = body.requests.filter(
    (entry) =>
      entry.path === "/api/v4/capture/events" &&
      entry.authorization === "Bearer customer-token",
  );
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(events[1].lastEventId).toBe("1");
  const requestHeaders = await Promise.all(
    pageEventRequests.map((browserRequest) => browserRequest.allHeaders()),
  );
  expect(requestHeaders.length).toBeGreaterThanOrEqual(2);
  expect(requestHeaders.every((headers) => headers.authorization === "Bearer customer-token")).toBe(
    true,
  );
});

test("事件流持续断线时禁用写操作且限制重连频率", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await request.post("/__fixture/config", { data: { eventsUnavailable: true } });
  await request.post("/__fixture/disconnect-events");

  await expect(page.locator(".connection")).toHaveText("连接中断");
  await expect(page.getByRole("button", { name: "开始录制" })).toBeDisabled();
  await expect(page.getByLabel("录制名称")).toBeDisabled();
  const firstResponse = await request.get("/__fixture/requests");
  const firstBody = /** @type {{requests: Array<{path: string}>}} */ (
    await firstResponse.json()
  );
  const firstCount = firstBody.requests.filter(
    (entry) => entry.path === "/api/v4/capture/events",
  ).length;

  await page.waitForTimeout(650);

  const laterResponse = await request.get("/__fixture/requests");
  const laterBody = /** @type {{requests: Array<{path: string}>}} */ (
    await laterResponse.json()
  );
  const laterCount = laterBody.requests.filter(
    (entry) => entry.path === "/api/v4/capture/events",
  ).length;
  expect(laterCount - firstCount).toBeLessThanOrEqual(1);
});

test("事件流重连处理首个权威事件前保持写操作禁用", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await request.post("/__fixture/config", { data: { eventSnapshotDelayMs: 2000 } });
  await request.post("/__fixture/disconnect-events");
  await expect(page.locator(".connection")).toHaveText("连接中断");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
      return body.requests.filter((entry) => entry.path === "/api/v4/capture/events").length;
    })
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".connection")).toHaveText("连接中断");
  await expect(page.getByRole("button", { name: "开始录制" })).toBeDisabled();

  await expect(page.locator(".connection")).toHaveText("已连接");
  await expect(page.getByRole("button", { name: "开始录制" })).toBeEnabled();
});

test("事件流 401 停止重连并回到令牌入口", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await request.post("/__fixture/config", { data: { requireBearer: true } });
  await request.post("/__fixture/disconnect-events");

  await expect(page.getByLabel("设备访问令牌")).toBeVisible();
  await expect(page.locator(".connection")).toHaveText("连接中断");
  await expect(page.getByRole("button", { name: "开始录制" })).toBeDisabled();
  const unauthorizedResponse = await request.get("/__fixture/requests");
  const unauthorizedBody = /** @type {{requests: Array<{path: string}>}} */ (
    await unauthorizedResponse.json()
  );
  const unauthorizedCount = unauthorizedBody.requests.filter(
    (entry) => entry.path === "/api/v4/capture/events",
  ).length;

  await page.waitForTimeout(500);

  const laterResponse = await request.get("/__fixture/requests");
  const laterBody = /** @type {{requests: Array<{path: string}>}} */ (
    await laterResponse.json()
  );
  const laterCount = laterBody.requests.filter(
    (entry) => entry.path === "/api/v4/capture/events",
  ).length;
  expect(laterCount).toBe(unauthorizedCount);
});

test("慢预览响应不排队且录制期间继续更新左眼画面", async ({ page, request }) => {
  let previewInFlight = 0;
  let previewMaxInFlight = 0;
  /** @param {import("@playwright/test").Request} networkRequest */
  const isPagePreview = (networkRequest) =>
    new URL(networkRequest.url()).pathname === "/api/v4/preview";
  page.on("request", (networkRequest) => {
    if (isPagePreview(networkRequest)) {
      previewInFlight += 1;
      previewMaxInFlight = Math.max(previewMaxInFlight, previewInFlight);
    }
  });
  /** @param {import("@playwright/test").Request} networkRequest */
  const finishPreview = (networkRequest) => {
    if (isPagePreview(networkRequest)) {
      previewInFlight -= 1;
    }
  };
  page.on("requestfinished", finishPreview);
  page.on("requestfailed", finishPreview);

  await request.post("/__fixture/config", { data: { previewDelayMs: 180 } });
  await page.goto("/");

  await expect(page.getByTestId("preview-image")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByTestId("preview-image")
        .evaluate((image) => /** @type {HTMLImageElement} */ (image).naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.getByLabel("录制名称").fill("预览不中断");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      return (await response.json()).preview.requests;
    })
    .toBeGreaterThanOrEqual(3);

  expect(previewMaxInFlight).toBe(1);
});

test("预览循环不会累积中止监听器", async ({ page, request }) => {
  await page.addInitScript(() => {
    const metrics = { active: 0, peak: 0 };
    Object.defineProperty(window, "__rpYlxAbortMetrics", { value: metrics });
    const originalAdd = AbortSignal.prototype.addEventListener;
    const originalRemove = AbortSignal.prototype.removeEventListener;
    AbortSignal.prototype.addEventListener = new Proxy(originalAdd, {
      apply(target, thisArgument, argumentsList) {
        if (argumentsList[0] === "abort") {
          metrics.active += 1;
          metrics.peak = Math.max(metrics.peak, metrics.active);
        }
        return Reflect.apply(target, thisArgument, argumentsList);
      },
    });
    AbortSignal.prototype.removeEventListener = new Proxy(originalRemove, {
      apply(target, thisArgument, argumentsList) {
        if (argumentsList[0] === "abort") {
          metrics.active -= 1;
        }
        return Reflect.apply(target, thisArgument, argumentsList);
      },
    });
  });
  await page.goto("/");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      return (await response.json()).preview.requests;
    })
    .toBeGreaterThanOrEqual(12);

  const activeListeners = await page.evaluate(
    () => /** @type {any} */ (window).__rpYlxAbortMetrics.active,
  );
  expect(activeListeners).toBeLessThanOrEqual(1);
});

test("空闲预览不可用不会持续污染浏览器控制台", async ({ page }) => {
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });
  await page.route("**/api/v4/preview", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        schema: "ylx.api-error.v2",
        error: {
          code: "preview_unavailable",
          message: "当前没有可用的预览帧",
          request_id: "12c175c7-a794-45f5-b6c7-348c3e73bc22",
          retryable: true,
        },
      }),
    });
  });

  await page.goto("/");

  await expect(page.getByText("画面暂不可用", { exact: true })).toBeVisible();
  await page.waitForTimeout(650);
  expect(warnings).toEqual([]);
});

test("只有 typed safe-swap 回执允许移除存储设备且刷新可恢复", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("可以移除存储设备")).not.toBeVisible();

  await page.getByLabel("录制名称").fill("换盘测试");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await page.getByRole("button", { name: "安全换盘" }).click();

  await expect(page.getByTestId("capture-state")).toHaveText("正在结束");
  await expect(page.getByText("可以移除存储设备")).not.toBeVisible();

  await request.post("/__fixture/safe-swap");
  await expect(page.getByText("可以移除存储设备", { exact: true })).toBeVisible();
  await expect(page.getByTestId("safe-swap-release")).toHaveText("设备已释放");

  await page.reload();
  await expect(page.getByText("可以移除存储设备", { exact: true })).toBeVisible();
});

test("跳号换盘事件只通过权威状态和回执资源收敛", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("跳号换盘");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await page.getByRole("button", { name: "安全换盘" }).click();

  await request.post("/__fixture/safe-swap-gap");

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByText("可以移除存储设备", { exact: true })).toBeVisible();
});

test("仍挂载或存在打开句柄的换盘事件不能授权移除", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("拒绝不安全回执");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");

  await request.post("/__fixture/unsafe-safe-swap", { data: { state: "mounted" } });
  await expect(page.getByText("可以移除存储设备", { exact: true })).not.toBeVisible();
  await request.post("/__fixture/unsafe-safe-swap", { data: { state: "open-handles" } });
  await expect(page.getByText("可以移除存储设备", { exact: true })).not.toBeVisible();

  await page.getByRole("button", { name: "安全换盘" }).click();
  await request.post("/__fixture/safe-swap");
  await expect(page.getByText("可以移除存储设备", { exact: true })).toBeVisible();
});

test("结束录制接受空 204 并重新读取权威状态", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { stopReturns204: true } });
  await page.goto("/");
  await page.getByLabel("录制名称").fill("空响应结束");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");

  await page.getByRole("button", { name: "结束录制" }).click();

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("结束录制后新封存会话无刷新有界同步到台账", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { sessionsDelayMs: 1000 } });
  await page.goto("/");

  const sessionRequestCount = async () => {
    const response = await request.get("/__fixture/requests");
    const body = /** @type {{requests: Array<{path: string}>}} */ (await response.json());
    return body.requests.filter((entry) => entry.path === "/api/v4/sessions").length;
  };
  await expect.poll(sessionRequestCount).toBeGreaterThanOrEqual(1);

  const names = ["终态刷新第一段", "终态刷新第二段"];
  for (const name of names) {
    await page.getByLabel("录制名称").fill(name);
    await page.getByRole("button", { name: "开始录制" }).click();
    await expect(page.getByTestId("capture-state")).toHaveText("录制中");
    await page.getByRole("button", { name: "结束录制" }).click();
    await expect(page.getByTestId("capture-state")).toHaveText("待机");
  }

  await openPanel(page, "会话台账");
  for (const name of names) {
    await expect(page.getByTestId("session-item").filter({ hasText: name })).toHaveCount(1);
  }

  const settledCount = await sessionRequestCount();
  expect(settledCount).toBeGreaterThanOrEqual(2);
  expect(settledCount).toBeLessThanOrEqual(8);

  await page.waitForTimeout(650);
  expect(await sessionRequestCount()).toBe(settledCount);
});

test("会话晚于终态发布时仍自动进入台账", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { sessionPublicationDelayMs: 2000 } });
  await page.goto("/");

  const name = "延迟发布仍自动刷新";
  await page.getByLabel("录制名称").fill(name);
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await page.getByRole("button", { name: "结束录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("待机");

  await openPanel(page, "会话台账");
  await expect(page.getByTestId("session-item").filter({ hasText: name })).toHaveCount(1, {
    timeout: 5000,
  });
});

test("开始录制原样显示 API problem 且服务恢复后可重试", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { startProblem: true } });
  await page.goto("/");
  await page.getByLabel("录制名称").fill("错误恢复");
  await page.getByRole("button", { name: "开始录制" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("capture_busy");
  await expect(alert).toContainText(
    "Artifact transfer is paused until the device returns to idle.",
  );
  const overlapsWorkspace = await alert.evaluate((alertElement) => {
    const alertBounds = alertElement.getBoundingClientRect();
    return Array.from(document.querySelectorAll(".workspace .panel")).some((panel) => {
      const panelBounds = panel.getBoundingClientRect();
      return !(
        alertBounds.right <= panelBounds.left ||
        alertBounds.left >= panelBounds.right ||
        alertBounds.bottom <= panelBounds.top ||
        alertBounds.top >= panelBounds.bottom
      );
    });
  });
  expect(overlapsWorkspace).toBe(false);
  const alertBounds = await alert.boundingBox();
  expect(alertBounds).not.toBeNull();
  expect(alertBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(960);
  await expect(page.getByRole("button", { name: "开始录制" })).toBeEnabled();

  await request.post("/__fixture/config", { data: { startProblem: false } });
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("结束录制原样显示 API problem 且服务恢复后可重试", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("结束错误恢复");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await request.post("/__fixture/config", { data: { stopProblem: true } });

  await page.getByRole("button", { name: "结束录制" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("storage_finalize_failed");
  await expect(alert).toContainText("存储封存暂时失败，请重试");
  await expect(page.getByRole("button", { name: "结束录制" })).toBeEnabled();

  await request.post("/__fixture/config", { data: { stopProblem: false } });
  await page.getByRole("button", { name: "结束录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("新录制清除旧换盘回执且拒绝旧 authority 事件", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("第一段换盘");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await page.getByRole("button", { name: "安全换盘" }).click();
  await request.post("/__fixture/safe-swap");
  await expect(page.getByText("可以移除存储设备", { exact: true })).toBeVisible();

  await request.post("/__fixture/new-authority-recording");
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await expect(page.getByText("可以移除存储设备", { exact: true })).not.toBeVisible();

  await request.post("/__fixture/stale-safe-swap");
  await expect(page.getByText("可以移除存储设备", { exact: true })).not.toBeVisible();
});

test("会话列表保持生产终态与网关可用性分离并显示发现诊断", async ({ page }) => {
  await page.goto("/");
  await openPanel(page, "会话台账");

  const usableSession = page.getByTestId("session-item").filter({ hasText: "入口标定" });
  await expect(usableSession.getByText("已封存", { exact: true })).toBeVisible();
  await expect(usableSession.getByText("可用", { exact: true })).toBeVisible();

  const unknownSession = page.getByTestId("session-item").filter({ hasText: "第二段采集" });
  await expect(unknownSession.getByText("尚未校验", { exact: true })).toBeVisible();
  await expect(page.getByText("发现一个无法读取的会话清单，已隔离")).toBeVisible();
});

test("刷新页面不会把历史 retained 失败作为新错误弹出", async ({ page, request }) => {
  await request.post("/__fixture/interrupted-capture");

  await page.goto("/");

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByTestId("retained-outcome")).toHaveText("可恢复失败");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("process_interrupted", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "开始录制" })).toBeEnabled();
});

test("外部客户端快照触发容量和最近会话有界重拉", async ({ page, request }) => {
  await page.goto("/");
  await openPanel(page, "会话台账");
  await expect(page.getByTestId("storage-available")).toHaveText("82.0 GiB");
  await expect(page.getByText("外部客户端封存", { exact: true })).not.toBeVisible();

  await request.post("/__fixture/related-resources");

  await expect(page.getByTestId("storage-available")).toHaveText("64.0 GiB");
  await expect(page.getByText("外部客户端封存", { exact: true })).toBeVisible();
});

test("重新打开会话台账会立即读取静默新增目录", async ({ page, request }) => {
  await page.goto("/");
  const panel = await openPanel(page, "会话台账");
  await expect(page.getByText("外部客户端封存", { exact: true })).not.toBeVisible();
  await panel.getByRole("button", { name: "关闭" }).click();

  await request.post("/__fixture/related-resources-silent");
  await openPanel(page, "会话台账");

  await expect(page.getByText("外部客户端封存", { exact: true })).toBeVisible();
});

test("会话台账刷新按钮读取静默新增目录", async ({ page, request }) => {
  await page.goto("/");
  const panel = await openPanel(page, "会话台账");
  await expect(page.getByText("外部客户端封存", { exact: true })).not.toBeVisible();
  await request.post("/__fixture/related-resources-silent");

  const beforeResponse = await request.get("/__fixture/requests");
  const beforeBody = /** @type {{requests: Array<{path: string}>}} */ (await beforeResponse.json());
  const beforeCount = beforeBody.requests.filter(
    (entry) => entry.path === "/api/v4/sessions",
  ).length;
  await panel.getByRole("button", { name: "刷新会话" }).click();

  await expect(page.getByText("外部客户端封存", { exact: true })).toBeVisible();
  const afterResponse = await request.get("/__fixture/requests");
  const afterBody = /** @type {{requests: Array<{path: string}>}} */ (await afterResponse.json());
  expect(
    afterBody.requests.filter((entry) => entry.path === "/api/v4/sessions").length,
  ).toBeGreaterThan(beforeCount);
});

test("设备诊断通过 SSE 原样呈现 code message 和 details", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await request.post("/__fixture/diagnostic");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("media_lost");
  await expect(alert).toContainText(
    "The selected recording volume disappeared before finalization.",
  );
  await expect(alert).toContainText('"action":"reinsert_same_volume"');
  await expect(alert.getByRole("time")).toHaveText("2026-08-08T13:01:02+08:00");
});

test("两个浏览器最终收敛到同一录制状态", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);
  await Promise.all([
    expect(first.getByTestId("capture-state")).toHaveText("待机"),
    expect(second.getByTestId("capture-state")).toHaveText("待机"),
  ]);

  await first.getByLabel("录制名称").fill("双客户端测试");
  await first.getByRole("button", { name: "开始录制" }).click();
  await Promise.all([
    expect(first.getByTestId("capture-state")).toHaveText("录制中"),
    expect(second.getByTestId("capture-state")).toHaveText("录制中"),
  ]);

  await second.getByRole("button", { name: "结束录制" }).click();
  await Promise.all([
    expect(first.getByTestId("capture-state")).toHaveText("待机"),
    expect(second.getByTestId("capture-state")).toHaveText("待机"),
  ]);
  await context.close();
});

test("未成功终态保留诊断且不伪装成封存会话", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("失败录制");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");
  await request.post("/__fixture/fail-capture");

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByTestId("retained-outcome")).toHaveText("失败");
  const alert = page.getByRole("alert");
  await expect(alert.getByText("source_decode_failed", { exact: true })).toBeVisible();
  await expect(
    alert.getByText(
      "A captured source frame could not be decoded, so the session was terminated without a manifest.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(alert.getByRole("time")).toHaveText("2026-08-08T13:50:18+08:00");
  await openPanel(page, "会话台账");
  await expect(
    page.getByTestId("session-item").filter({ hasText: "YLX-30D5872D" }),
  ).toHaveCount(0);
});

test("progress 事件触发权威快照刷新并显示录制计数", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("录制名称").fill("进度测试");
  await page.getByRole("button", { name: "开始录制" }).click();
  await expect(page.getByTestId("capture-state")).toHaveText("录制中");

  await request.post("/__fixture/progress");
  await expect(page.getByTestId("captured-frames")).toHaveText("744");
  await expect(page.getByTestId("bytes-written")).toHaveText("42.0 MiB");
  await expect
    .poll(async () =>
      Number.parseFloat((await page.getByTestId("elapsed-seconds").textContent()) ?? "0"),
    )
    .toBeGreaterThanOrEqual(12.4);
  const authoritativeElapsed = Number.parseFloat(
    (await page.getByTestId("elapsed-seconds").textContent()) ?? "0",
  );
  expect(authoritativeElapsed).toBeLessThan(25);
  const samples = await page.evaluate(async () => {
    const values = [];
    for (let index = 0; index < 7; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      values.push(
        Number.parseFloat(document.querySelector('[data-testid="elapsed-seconds"]')?.textContent ?? "0"),
      );
    }
    return values;
  });
  expect(new Set(samples).size).toBeGreaterThanOrEqual(3);
  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
  }

  const beforeCorrection = samples.at(-1) ?? 0;
  await request.post("/__fixture/progress");
  await expect(page.getByTestId("captured-frames")).toHaveText("756");
  const afterCorrection = Number.parseFloat(
    (await page.getByTestId("elapsed-seconds").textContent()) ?? "0",
  );
  expect(afterCorrection).toBeGreaterThanOrEqual(beforeCorrection);
});

test("customer 401 后可输入 Bearer 令牌并连接设备", async ({ page, request }) => {
  await request.post("/__fixture/config", { data: { requireBearer: true } });
  await page.goto("/");

  await expect(page.getByLabel("设备访问令牌")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("authentication_required");
  await expect(page.getByRole("alert")).toContainText("需要设备访问令牌");
  await page.getByLabel("设备访问令牌").fill("customer-token");
  await page.getByRole("button", { name: "连接设备" }).click();

  await expect(page.getByTestId("capture-state")).toHaveText("待机");
  await expect(page.getByLabel("设备访问令牌")).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("rp-ylx-access-token")),
  ).toBe("customer-token");

  await expect
    .poll(async () => {
      const response = await request.get("/__fixture/requests");
      return (await response.json()).preview.requests;
    })
    .toBeGreaterThanOrEqual(2);
  const response = await request.get("/__fixture/requests");
  const body = /** @type {{requests: Array<{path: string, authorization: string | null}>, preview: {maxConcurrent: number}}} */ (
    await response.json()
  );
  const authenticatedEvents = body.requests.filter(
    (entry) =>
      entry.path === "/api/v4/capture/events" &&
      entry.authorization === "Bearer customer-token",
  );
  expect(authenticatedEvents).toHaveLength(1);
  expect(body.preview.maxConcurrent).toBe(1);
});
