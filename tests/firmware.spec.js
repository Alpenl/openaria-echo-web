// @ts-check
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__fixture/reset"); });

function status() {
  return {
    schema: "openaria.firmware-status.v1", supported: true,
    current: { version: "0.2.1", commit: "a".repeat(40) },
    previous: { version: "0.1.0", commit: "b".repeat(40) },
    available: { version: "0.2.2", commit: "c".repeat(40), release_notes: "修复录制问题", published_at: null },
    has_update: true, checked_at: 100, warning: null, task: null,
  };
}

test("版本入口、检查更新、确认提交及完成后刷新", async ({ page }) => {
  const value = status();
  let posts = 0;
  await page.route("**/api/v4/firmware**", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ commit: "c".repeat(40) });
      expect(route.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      const task = { id: "550e8400-e29b-41d4-a716-446655440000", action: "update",
        target_commit: "c".repeat(40), status: "running", message: "正在安装", started_at: 100, finished_at: null };
      value.task = /** @type {any} */ (task);
      await route.fulfill({ status: 202, json: task });
    } else await route.fulfill({ json: value });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("v0.2.1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "立即更新", exact: true }).click();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "立即更新", exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  value.current = { version: "0.2.2", commit: "c".repeat(40) };
  value.has_update = false;
  value.task = /** @type {any} */ ({ ...value.task, status: "succeeded", message: "更新完成", finished_at: 110 });
  await expect(page.getByText("操作完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
});

test("检查失败不显示已是最新，录制时禁止升级和回退", async ({ page }) => {
  const value = status();
  value.has_update = false;
  value.warning = /** @type {any} */ ("无法连接发布源");
  await page.route("**/api/v4/firmware**", (route) => route.fulfill({ json: value }));
  await page.goto("/");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法连接发布源");
  await expect(page.getByText("已是最新版本", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回退上一版本", exact: true })).toBeDisabled();
});

test("旧固件保留版本入口并说明首次升级方式", async ({ page }) => {
  await page.route("**/api/v4/firmware**", (route) => route.fulfill({ status: 404, json: {} }));
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("当前固件尚不支持网页更新。请先通过设备更新命令升级一次。")).toBeVisible();
  await expect(page.getByRole("button", { name: "检查更新", exact: true })).toBeDisabled();
});

test("刷新浏览器恢复设备任务，短暂断线后继续显示结果", async ({ page }) => {
  const value = status();
  value.task = /** @type {any} */ ({ id: "550e8400-e29b-41d4-a716-446655440000", action: "rollback",
    target_commit: "b".repeat(40), status: "running", message: "正在回退", started_at: 100, finished_at: null });
  let offline = false;
  await page.route("**/api/v4/firmware**", (route) => offline ? route.abort() : route.fulfill({ json: value }));
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("正在回退", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("正在回退", { exact: true })).toBeVisible();
  offline = true;
  await expect(page.getByText("设备暂时断开，正在等待重新连接并查询任务结果…")).toBeVisible();
  offline = false;
  value.task = /** @type {any} */ ({ ...value.task, status: "failed", message: "回退失败，请检查当前版本", finished_at: 110 });
  await expect(page.getByText("操作失败", { exact: true })).toBeVisible();
});
