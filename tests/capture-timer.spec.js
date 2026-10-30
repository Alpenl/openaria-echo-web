import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__fixture/reset"); });

async function timerFixture(page, failSave = false) {
  let settings = { enabled: false, duration_seconds: 600 };
  const writes = [];
  await page.route("**/api/v4/capture/timer", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (failSave) return route.fulfill({ status: 500, contentType: "application/problem+json",
        body: JSON.stringify({ title: "保存失败", detail: "保存失败", code: "persistence_failed" }) });
      settings = { enabled: body.enabled, duration_seconds: body.duration_seconds };
    }
    await route.fulfill({ json: { schema: "ylx.capture-timer.v1", settings, active: null } });
  });
  return writes;
}

test("定时设置保存后刷新保持并可关闭", async ({ page }) => {
  const writes = await timerFixture(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "定时结束设置" });
  await expect(trigger).toContainText("关");
  await trigger.click();
  await page.getByLabel("开启定时结束").check();
  await page.getByLabel("定时时长（分钟）").fill("10");
  await page.getByLabel("定时时长（秒）").fill("15");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(writes).toEqual([{ schema: "ylx.capture-timer-set.v1", enabled: true, duration_seconds: 615 }]);
  await page.reload();
  await expect(trigger).toContainText("10:15");
  await trigger.click();
  await expect(page.getByLabel("开启定时结束")).toBeChecked();
  await page.getByLabel("开启定时结束").uncheck();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(trigger).toContainText("关");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束录制", exact: true })).toBeEnabled();
  await trigger.click();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "结束录制", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});

test("定时非法时长与保存失败不会误报成功", async ({ page }) => {
  const writes = await timerFixture(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "定时结束设置" }).click();
  await page.getByLabel("定时时长（分钟）").fill("0");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await page.getByLabel("定时时长（分钟）").fill("1441");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await page.getByLabel("定时时长（分钟）").fill("10");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("保存失败");
});

test("定时面板在窄屏和横屏可操作", async ({ page }, testInfo) => {
  await timerFixture(page);
  await page.goto("/");
  for (const size of [{ width: 320, height: 640 }, { width: 800, height: 360 }]) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "定时结束设置" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: testInfo.outputPath(`timer-${size.width}.png`) });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
  }
});

test("旧固件无定时接口仍可正常开始录制", async ({ page }) => {
  await page.route("**/api/v4/capture/timer", route => route.fulfill({ status: 404,
    json: { code: "not_found", detail: "not found" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "定时结束设置" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});


test("倒计时来自设备，刷新保持且网页不会自行停止", async ({ page, request }) => {
  let remaining = 30;
  await page.route("**/api/v4/capture/timer", async route => {
    const capture = await (await request.get("/api/v4/capture/status")).json();
    const sid = capture.snapshot.active_recording?.recording_state?.session_id;
    await route.fulfill({ json: { schema: "ylx.capture-timer.v1",
      settings: { enabled: true, duration_seconds: 600 },
      active: sid ? { session_id: sid, duration_seconds: 600, remaining_seconds: remaining } : null } });
  });
  await request.post("/__fixture/state", { data: { deviceState: "recording", displayName: "定时录制" } });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "定时结束设置" });
  await expect(trigger).toContainText("剩余 0:30");
  await page.reload();
  await expect(trigger).toContainText("剩余 0:30");
  remaining = 0;
  await expect(trigger).toContainText("剩余 0:00");
  const logs = await (await request.get("/__fixture/requests")).json();
  expect(logs.requests.filter(r => r.path === "/api/v4/capture/stop")).toHaveLength(0);
  await request.post("/__fixture/terminal-state-event");
  await expect(trigger).not.toContainText("剩余");
});
