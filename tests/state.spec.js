// @ts-check

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { API_ROOT, DEVICE_API_CONSUMER_SUPPORT, deviceApi } from "../src/api/client.ts";
import { initialState, reduceState } from "../src/state/reducer.ts";

const authorityEpoch = "4fa85f64-5717-4562-b3fc-2c963f66afa6";
const consumerSupportManifest = JSON.parse(
  readFileSync(new URL("../contracts/ylx-device-api-support.json", import.meta.url), "utf8"),
);

test("Device API consumer support is v4-only and fail-closed", () => {
  const v4Contract = {
    major: 4,
    path: "openapi/ylx-device-v4.openapi.yaml",
    sha256: "bc41fd6716290d9dfc1ed2a1129f2cdf7b8347ed83ee37d2e9ba2020131ba9a8",
    bytes: 68751,
    info_version: "4.0.0",
    server_base_path: "/api/v4",
    lifecycle: "current",
  };

  expect(API_ROOT).toBe("/api/v4");
  expect(DEVICE_API_CONSUMER_SUPPORT).toEqual({
    schema: "ylx.device-api-consumer-support.v1",
    consumer: "openaria-echo-web",
    supported_device_api_majors: [4],
    unknown_major_policy: "fail_closed",
    required_contracts: [v4Contract],
  });
  expect(consumerSupportManifest).toEqual(DEVICE_API_CONSUMER_SUPPORT);
  expect(consumerSupportManifest.required_contracts).toEqual([v4Contract]);
  expect(deviceApi.artifactUrl("session", "artifact")).toBe(
    "/api/v4/sessions/session/artifacts/artifact",
  );
});

/** @param {number} sourceRevision @param {string} deviceState */
function captureStatus(sourceRevision, deviceState) {
  return {
    schema: "ylx.capture-status.v4",
    authority_epoch: authorityEpoch,
    source_revision: sourceRevision,
    snapshot: {
      schema: "ylx.capture-snapshot-event.v4",
      device_state: deviceState,
      active_recording: null,
      retained_unsuccessful: null,
      runtime: {
        observed_at: "2026-08-12T02:25:00Z",
        connection_method: "wifi_ap",
        temperature_celsius: 43.5,
        network: {
          ap: {
            state: "active",
            interface: "wlan0",
            addresses: ["10.42.0.1/24"],
            peer_or_ssid: "YLX-A1B2C3D4",
          },
          wifi_client: {
            state: "disabled",
            interface: null,
            addresses: [],
            peer_or_ssid: null,
          },
          wired: {
            state: "disconnected",
            interface: "eth0",
            addresses: [],
            peer_or_ssid: null,
          },
          default_route: "none",
        },
        live_imu: null,
        camera_focus: null,
      },
    },
  };
}

test("同 authority 下旧 capture snapshot 不能覆盖更高 revision 状态", () => {
  let state = reduceState(
    { ...initialState, connection: "connected" },
    { type: "capture.snapshot", payload: captureStatus(5, "idle") },
  );

  state = reduceState(state, {
    type: "capture.snapshot",
    payload: captureStatus(3, "finalizing"),
  });

  expect(state.capture?.source_revision).toBe(5);
  expect(state.capture?.snapshot.device_state).toBe("idle");
});

test("焦距更新同步写入 device 与 capture runtime", () => {
  /** @type {import("../../src/rp_ylx/web/state.js").CameraFocusStatus} */
  const focus = {
    schema: "ylx.camera-focus.v1",
    value: 77,
    minimum: 0,
    maximum: 255,
    step: 1,
    default: 32,
    auto_supported: true,
    auto_enabled: false,
  };
  /** @type {import("../../src/rp_ylx/web/state.js").DeviceDescriptor} */
  const device = {
    device: { device_id: "device", device_label: "YLX" },
    capabilities: {
      capture: true,
      preview: true,
      range_download: true,
      network_mutation: false,
    },
    storage: {
      volume_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      total_bytes: 10,
      available_bytes: 5,
      writable: true,
    },
    runtime: captureStatus(5, "idle").snapshot.runtime,
  };
  let state = reduceState(initialState, { type: "device.loaded", payload: device });
  state = reduceState(state, { type: "capture.snapshot", payload: captureStatus(5, "idle") });
  state = reduceState(state, { type: "camera-focus.updated", payload: focus });

  expect(state.device?.runtime.camera_focus).toEqual(focus);
  expect(state.capture?.snapshot.runtime.camera_focus).toEqual(focus);
  expect(state.error).toBeNull();
});
