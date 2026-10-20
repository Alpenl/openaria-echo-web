// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { EchoStore } from "../src/state/store.ts";

const failed = JSON.parse(readFileSync(new URL("./fixtures/recording-state-failed.json", import.meta.url), "utf8"));
function snapshot(revision, active, diagnostics = failed.diagnostics) {
  const recording = { generation_id: "11111111-1111-4111-8111-111111111111",
    recording_state: { ...structuredClone(failed), state: active ? "finalizing" : "failed", diagnostics } };
  return { schema: "ylx.capture-status.v4", authority_epoch: failed.authority_epoch,
    source_revision: revision, snapshot: { schema: "ylx.capture-snapshot-event.v4",
      device_state: active ? "finalizing" : "idle", active_recording: active ? recording : null,
      retained_unsuccessful: active ? null : recording, runtime: null } };
}

test("活动收尾快照立即呈现错误，刷新页面也可见", () => {
  const store = new EchoStore();
  const status = snapshot(10, true);
  store.dispatch({ type: "capture.snapshot", payload: status });
  expect(store.getState().diagnostics).toEqual(failed.diagnostics);
  expect(store.getState().capture).toBe(status);
  expect(store.getState().capture.snapshot.device_state).toBe("finalizing");
});

test("重复活动诊断及随后失败终态只播报一次", () => {
  const store = new EchoStore();
  store.dispatch({ type: "capture.snapshot", payload: snapshot(10, true, [...failed.diagnostics, ...failed.diagnostics]) });
  store.dispatch({ type: "capture.snapshot", payload: snapshot(11, true) });
  store.dispatch({ type: "capture.snapshot", payload: snapshot(12, false) });
  expect(store.getState().diagnostics).toEqual(failed.diagnostics);
});

test("过期活动及终态快照均不能注入警报", () => {
  for (const active of [true, false]) {
    const store = new EchoStore();
    store.dispatch({ type: "capture.snapshot", payload: snapshot(10, true, []) });
    store.dispatch({ type: "capture.snapshot", payload: snapshot(9, active) });
    expect(store.getState().capture.source_revision).toBe(10);
    expect(store.getState().diagnostics).toEqual([]);
  }
});

test("初次打开页面不把历史失败重新播报", () => {
  const store = new EchoStore();
  store.dispatch({ type: "capture.snapshot", payload: snapshot(10, false) });
  expect(store.getState().diagnostics).toEqual([]);
  expect(store.getState().capture.snapshot.retained_unsuccessful).not.toBeNull();
});
