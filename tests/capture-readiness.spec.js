import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__fixture/reset"); });

const budget = (available, required) => ({ available_bytes: available, required_bytes: required });
const ready = { schema: "ylx.capture-readiness.v1", allowed: true, code: "ready",
  message: "可以开始新录制", storage: { recording: budget(8 * 1024 ** 3, 2 * 1024 ** 3),
    system: budget(1024 ** 3, 256 * 1024 ** 2), backing: null } };

test("系统盘不足显示真正原因并在空间恢复后自动允许录制", async ({ page }) => {
  let value = { ...ready, allowed: false, code: "insufficient_space",
    message: "系统状态盘可用空间不足，至少需要 256 MiB",
    storage: { ...ready.storage, system: budget(100 * 1024 ** 2, 256 * 1024 ** 2) } };
  await page.route("**/api/v4/capture/readiness", route => route.fulfill({ json: value }));
  await page.goto("/");
  await expect(page.getByLabel("当前录制条件")).toContainText("系统状态盘可用空间不足");
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeDisabled();
  value = ready;
  await expect(page.getByLabel("当前录制条件")).toContainText("可以开始新录制");
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});

test("失败收尾等待期间不提前允许开始，释放后自动恢复", async ({ page }) => {
  let value = { ...ready, allowed: false, code: "recovery_pending", message: "正在保存上次录制并释放资源" };
  await page.route("**/api/v4/capture/readiness", route => route.fulfill({ json: value }));
  await page.goto("/");
  await expect(page.getByLabel("当前录制条件")).toContainText("释放资源");
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeDisabled();
  value = ready;
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});

test("已支持的准入接口读取失败不能沿用过期允许状态", async ({ page }) => {
  let failing = false;
  await page.route("**/api/v4/capture/readiness", route => failing
    ? route.fulfill({ status: 503, body: "unavailable" }) : route.fulfill({ json: ready }));
  await page.goto("/");
  await expect(page.getByLabel("当前录制条件")).toContainText("可以开始");
  failing = true;
  await expect(page.getByLabel("当前录制条件")).toContainText("正在重试");
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeDisabled();
  failing = false;
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeEnabled();
});
