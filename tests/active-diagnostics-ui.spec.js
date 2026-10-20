// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const failed = JSON.parse(readFileSync(new URL("./fixtures/recording-state-failed.json", import.meta.url), "utf8"));

test("收尾期间显示活动录制错误并保持忙碌状态", async ({ page, request }) => {
  await request.post("/__fixture/reset");
  await page.route("**/api/v4/capture/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.source_revision = 1000;
    body.snapshot.device_state = "finalizing";
    body.snapshot.retained_unsuccessful = null;
    body.snapshot.active_recording = {
      generation_id: "11111111-1111-4111-8111-111111111111",
      recording_state: { ...structuredClone(failed), state: "finalizing", authority_epoch: body.authority_epoch },
    };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert.getByText("source_decode_failed", { exact: true })).toBeVisible();
  await expect(alert).toContainText(failed.diagnostics[0].message);
  await expect(page.getByTestId("capture-state")).toHaveAttribute("data-state", "finalizing");
  await expect(page.getByTestId("captured-frames")).toHaveText("540");
  await expect(page.getByTestId("retained-outcome")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("alert").getByText("source_decode_failed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("capture-state")).toHaveAttribute("data-state", "finalizing");
});
