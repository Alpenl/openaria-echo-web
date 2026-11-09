// @ts-check
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

function clockStatus(source = "unsynchronized") {
  return {
    schema: "ylx.clock-status.v1", source,
    unix_time_ms: source === "unsynchronized" ? 946684800000 : Date.now(),
    challenge: source === "unsynchronized" ? "a".repeat(32) : null,
    expires_in_ms: source === "unsynchronized" ? 5000 : 0,
    applied: false,
  };
}

test("离线开机自动取浏览器日期，录制前等待校时完成", async ({ page }) => {
  const calls = [];
  let source = "unsynchronized";
  await page.route("**/api/v4/clock", (route) => route.fulfill({ json: clockStatus(source) }));
  await page.route("**/api/v4/clock/sync", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    calls.push("sync");
    expect(body.schema).toBe("ylx.clock-sync-request.v1");
    expect(body.challenge).toBe("a".repeat(32));
    expect(Math.abs(body.unix_time_ms - Date.now())).toBeLessThan(2000);
    source = "client";
    await route.fulfill({ json: { ...clockStatus(source), applied: true } });
  });
  await page.route("**/api/v4/capture/start", async (route) => {
    calls.push("start");
    await route.continue();
  });
  await page.goto("/");
  await expect.poll(() => calls).toEqual(["sync"]);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeVisible();
  expect(calls).toEqual(["sync", "start"]);
});

test("NTP 已同步时不提交手机日期", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/v4/clock", (route) => route.fulfill({ json: clockStatus("ntp") }));
  await page.route("**/api/v4/clock/sync", async (route) => {
    writes += 1;
    await route.fulfill({ json: clockStatus("client") });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test("校时失败时录制前重试，成功后才开始录制", async ({ page, request }) => {
  let failed = true;
  let attempts = 0;
  let synced = false;
  await page.route("**/api/v4/clock", (route) => route.fulfill({ json: clockStatus(synced ? "client" : "unsynchronized") }));
  await page.route("**/api/v4/clock/sync", async (route) => {
    attempts += 1;
    if (!failed) synced = true;
    await route.fulfill(failed ? {
      status: 503, json: { error: { code: "clock_set_failed", message: "设备日期尚未校准，请重试" } },
    } : { json: { ...clockStatus("client"), applied: true } });
  });
  await page.goto("/");
  await expect.poll(() => attempts).toBe(1);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  const log = await (await request.get("/__fixture/requests")).json();
  expect(log.requests.filter((entry) => entry.path === "/api/v4/capture/start")).toHaveLength(0);
  failed = false;
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeVisible();
});

test("已打开的页面在设备重启后重新取得日期", async ({ page }) => {
  let source = "ntp";
  let writes = 0;
  let reads = 0;
  let rebooted = false;
  await page.route("**/api/v4/capture/events", (route) => route.abort());
  await page.route("**/api/v4/capture/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (rebooted) body.authority_epoch = "550e8400-e29b-41d4-a716-446655440000";
    await route.fulfill({ json: body });
  });
  await page.route("**/api/v4/clock", (route) => {
    reads += 1;
    return route.fulfill({ json: clockStatus(source) });
  });
  await page.route("**/api/v4/clock/sync", async (route) => {
    writes += 1;
    source = "client";
    await route.fulfill({ json: { ...clockStatus(source), applied: true } });
  });
  await page.goto("/");
  await expect.poll(() => reads).toBeGreaterThan(0);
  source = "unsynchronized";
  rebooted = true;
  // An authority change is observed by the normal capture poll, without a reload.
  await expect.poll(() => writes).toBe(1);
});

test("旧固件没有校时接口仍可录制", async ({ page }) => {
  await page.route("**/api/v4/clock", (route) => route.fulfill({ status: 404, json: {} }));
  await page.goto("/");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeVisible();
});

function extendedStatus(offset = 0, source = "client") {
  return { ...clockStatus(source), schema: "ylx.clock-status.v2", unix_time_ms: Date.now() + offset,
    challenge: "b".repeat(32), expires_in_ms: 5000,
    boot_id: "a4578322-241e-4b9c-bb54-a860d5a2aa37",
    synchronized_at_ms: source === "unsynchronized" ? null : Date.now() - 60000,
    age_seconds: source === "unsynchronized" ? null : 60 };
}

test("另一台手机相差两分钟只提示，确认后才重校并回读", async ({ page }) => {
  let offset = 120000;
  let writes = 0;
  await page.route("**/api/v4/clock/check", r => r.fulfill({ json: extendedStatus(offset) }));
  await page.route("**/api/v4/clock/sync", async r => {
    const body = r.request().postDataJSON();
    expect(body.replace).toBe(true);
    expect(body.schema).toBe("ylx.clock-sync-request.v2");
    writes++; offset = 0;
    await r.fulfill({ json: { ...extendedStatus(), applied: true } });
  });
  await page.goto("/");
  await expect(page.getByTestId("clock-status")).toContainText("时间与手机不一致");
  expect(writes).toBe(0);
  await page.getByTestId("clock-status").click();
  await page.getByRole("button", { name: "使用这台手机时间重新校准", exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "确认使用当前手机时间", exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByTestId("clock-status")).toContainText("时间已校准");
});

test("录制期间校时入口禁用，停止后恢复", async ({ page }) => {
  await page.route("**/api/v4/clock/check", r => r.fulfill({ json: extendedStatus() }));
  await page.goto("/");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeVisible();
  await page.getByTestId("clock-status").click();
  await expect(page.getByRole("button", { name: "使用这台手机时间重新校准" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "结束录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeVisible();
  await page.getByTestId("clock-status").click();
  await expect(page.getByRole("button", { name: "使用这台手机时间重新校准" })).toBeEnabled();
});

test("校时回读仍是错误日期时不开始录制", async ({ page, request }) => {
  await page.route("**/api/v4/clock/check", r => r.fulfill({ json: extendedStatus(-120000, "unsynchronized") }));
  await page.route("**/api/v4/clock/sync", r => r.fulfill({ json: { ...extendedStatus(), applied: true } }));
  await page.goto("/");
  await expect(page.getByTestId("clock-status")).toContainText("校时失败");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const log = await (await request.get("/__fixture/requests")).json();
  expect(log.requests.filter(e => e.path === "/api/v4/capture/start")).toHaveLength(0);
});
