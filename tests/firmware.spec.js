// @ts-check
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__fixture/reset"); });

async function deviceBuild(page, commit) {
  await page.route("**/api/v4/device", async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.build.commit = commit();
    await route.fulfill({ json: value });
  });
}

function task(commit, state = "succeeded") {
  return { id: "550e8400-e29b-41d4-a716-446655440000", action: "update",
    target_commit: commit, status: state, message: state === "succeeded" ? "更新完成，设备服务已启动" : "正在安装",
    started_at: 100, finished_at: state === "succeeded" ? 110 : null };
}

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
  await deviceBuild(page, () => value.current.commit);
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
  await page.getByRole("button", { name: "刷新页面", exact: true }).click();
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("已是最新版本", { exact: true })).toBeVisible();
  await expect(page.getByText("操作完成", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toHaveCount(0);
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
  await expect(page.getByText("正在回退", { exact: true }).first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("正在回退", { exact: true }).first()).toBeVisible();
  offline = true;
  await expect(page.getByText("设备暂时断开，正在等待重新连接并查询任务结果…")).toBeVisible();
  offline = false;
  value.task = /** @type {any} */ ({ ...value.task, status: "failed", message: "回退失败，请检查当前版本", finished_at: 110 });
  await expect(page.getByText("操作失败", { exact: true })).toBeVisible();
});

test("历史完成任务不提示刷新，长说明后的确认按钮始终在视口内", async ({ page }) => {
  const value = status();
  value.task = /** @type {any} */ (task(value.current.commit));
  value.available.release_notes = "本次修复说明，保留高清预览和录制按钮。\n".repeat(60);
  let posts = 0;
  await deviceBuild(page, () => value.current.commit);
  await page.route("**/api/v4/firmware**", async route => {
    if (route.request().method() === "POST") {
      posts++;
      value.task = /** @type {any} */ (task(value.available.commit, "running"));
      await route.fulfill({ status: 202, json: value.task });
    } else await route.fulfill({ json: value });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "立即更新", exact: true })).toBeEnabled();
  await expect(page.getByText("操作完成", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "立即更新", exact: true }).click();
  const confirm = page.getByRole("button", { name: "确认更新", exact: true });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeFocused();
  expect(posts).toBe(0);
  await confirm.click();
  await expect(page.getByText("正在安装", { exact: true })).toBeVisible();
  await expect(page.getByText("正在安装", { exact: true })).toBeInViewport({ ratio: 1 });
  expect(posts).toBe(1);
});

test("只有目标版本和设备接口恢复后才显示完成与刷新", async ({ page }) => {
  const value = status();
  let liveCommit = value.current.commit;
  let captureOffline = false;
  await deviceBuild(page, () => liveCommit);
  await page.route("**/api/v4/capture/status", route => captureOffline ? route.abort() : route.continue());
  value.task = /** @type {any} */ (task(value.available.commit, "running"));
  await page.route("**/api/v4/firmware**", route => route.fulfill({ json: value }));
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByText("正在安装", { exact: true })).toBeVisible();
  value.task = /** @type {any} */ (task(value.available.commit));
  await expect(page.getByText("正在确认更新结果", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toHaveCount(0);
  value.current = { version: value.available.version, commit: value.available.commit };
  value.has_update = false;
  await expect(page.getByText("v0.2.2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toHaveCount(0);
  captureOffline = true;
  liveCommit = value.available.commit;
  await expect(page.getByText("设备暂时断开，正在等待重新连接并查询任务结果…")).toBeVisible();
  await expect(page.getByText("操作完成", { exact: true })).toHaveCount(0);
  captureOffline = false;
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
  await expect(page.getByText("操作完成", { exact: true })).toBeVisible();
});

test("事件流断开但实时 HTTP 确认空闲时仍可更新", async ({ page }) => {
  const value = status();
  await page.route("**/api/v4/capture/events**", route => route.abort());
  await page.route("**/api/v4/firmware**", route => route.fulfill({ json: value }));
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "立即更新", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "立即更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认更新", exact: true })).toBeEnabled();
});

test("确认期间设备开始录制后禁止提交", async ({ page }) => {
  const value = status();
  await page.route("**/api/v4/firmware**", route => route.fulfill({ json: value }));
  await page.goto("/");
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await page.getByRole("button", { name: "立即更新", exact: true }).click();
  const response = await page.request.post("/api/v4/capture/start", {
    data: { schema: "ylx.capture-start.v2", mode: "production", take: { kind: "new" } },
    headers: { "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440002" },
  });
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("button", { name: "确认更新", exact: true })).toBeDisabled();
});
