import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__fixture/reset"); });
async function fixture(page, fail = false) {
  let volume = 100;
  const writes = [];
  await page.route("**/api/v4/voice", route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push(body);
      if (fail) return route.fulfill({ status: 500, json: { code: "persistence_failed", detail: "保存失败" } });
      volume = body.volume;
    }
    return route.fulfill({ json: { schema: "ylx.voice.v1", enabled: true, volume } });
  });
  return writes;
}
async function slide(page, value) {
  await page.getByRole("slider", { name: "提示音量", exact: true }).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("音量保存刷新保持并支持静音", async ({ page }) => {
  const writes = await fixture(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "提示音量设置" });
  await expect(trigger).toContainText("100%"); await trigger.click();
  await slide(page, 35);
  await page.getByRole("button", { name: "保存音量", exact: true }).click();
  await expect(trigger).toContainText("35%");
  expect(writes).toEqual([{ schema: "ylx.voice-set.v1", volume: 35 }]);
  await page.reload(); await expect(trigger).toContainText("35%");
  await trigger.click(); await slide(page, 0);
  await page.getByRole("button", { name: "保存音量", exact: true }).click();
  await expect(trigger).toContainText("静音");
});

test("保存失败保留原音量，录制时不可修改", async ({ page, request }) => {
  await fixture(page, true); await page.goto("/");
  const trigger = page.getByRole("button", { name: "提示音量设置" });
  await trigger.click(); await slide(page, 40);
  await page.getByRole("button", { name: "保存音量", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload(); await expect(trigger).toContainText("100%");
  await request.post("/__fixture/state", { data: { deviceState: "recording", displayName: "测试" } });
  await page.reload(); await trigger.click();
  await expect(page.getByRole("slider", { name: "提示音量", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存音量" })).toBeDisabled();
});

test("旧固件不支持音量接口不影响录制", async ({ page }) => {
  await page.route("**/api/v4/voice", route => route.fulfill({ status: 404, json: { code: "not_found" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "提示音量设置" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});

test("窄屏音量面板和回车保存不会触发录制", async ({ page }, testInfo) => {
  await fixture(page); await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "提示音量设置" });
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeInViewport();
  await trigger.click();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("voice-volume.png") });
  await page.getByRole("slider", { name: "提示音量", exact: true }).focus(); await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});
