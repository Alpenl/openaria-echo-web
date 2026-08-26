// @ts-check

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { API_ROOT, DEVICE_API_CONSUMER_SUPPORT, deviceApi } from "../src/api/client.ts";
import {
  isNetworkCredentialReceipt,
  isNetworkStatus,
  isNetworkTransactionReceipt,
} from "../src/api/network.ts";
import { initialState, reduceState } from "../src/state/reducer.ts";
import { fitPeakingDimensions } from "../src/ui/FocusPeaking.tsx";

const authorityEpoch = "4fa85f64-5717-4562-b3fc-2c963f66afa6";
const consumerSupportManifest = JSON.parse(
  readFileSync(new URL("../contracts/ylx-device-api-support.json", import.meta.url), "utf8"),
);

test("峰值对焦把 4K 双目预览限制在有界像素预算内", () => {
  const dimensions = fitPeakingDimensions(3840, 1080);

  expect(dimensions.width / dimensions.height).toBeCloseTo(3840 / 1080, 2);
  expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(512 * 1024);
  expect(dimensions.width).toBeLessThan(3840);
});

test("Device API consumer support is v4-only and fail-closed", () => {
  const v4Contract = {
    major: 4,
    path: "openapi/ylx-device-v4.openapi.yaml",
    sha256: "f1185da08f50857d1f231701d14dfc42ab5cf3f6abce65d5d6d5c90510a52210",
    bytes: 120760,
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

test("全局状态不保存网络 secret 草稿", () => {
  const serialized = JSON.stringify(initialState).toLowerCase();

  expect(serialized).not.toContain("psk");
  expect(serialized).not.toContain("password");
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("token");
  expect(Object.keys(initialState)).not.toContain("networkDraft");
});

/** @param {Record<string, unknown>} [overrides] */
function networkTransaction(overrides = {}) {
  return {
    schema: "ylx.network-transaction.v1",
    authority_epoch: authorityEpoch,
    source_revision: 2,
    transaction_id: "0198d2a0-41a0-7b7a-a751-0e86a39d4db1",
    operation: "apply",
    status: "accepted",
    stage: "accepted",
    desired: { mode: "hotspot", wifi_client: null, ethernet: null },
    accepted_at: "2026-08-12T02:25:02Z",
    updated_at: "2026-08-12T02:25:02Z",
    deadline: null,
    recovery_action: "await_device",
    rescue: { ap_validated: true, fallback_mode: "hotspot", failure_trigger_seconds: 10 },
    error: null,
    ...overrides,
  };
}

/** @param {number} sourceRevision @param {Record<string, unknown>} [overrides] */
function networkStatus(sourceRevision, overrides = {}) {
  return {
    schema: "ylx.network-status.v1",
    authority_epoch: authorityEpoch,
    source_revision: sourceRevision,
    observed_at: "2026-08-12T02:25:02Z",
    saved: false,
    verified: false,
    desired: { mode: "hotspot", wifi_client: null, ethernet: null },
    observed: {
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
      mdns: {
        hostname: "rp-ylx.local",
        service: "_ylx-capture._tcp",
        aliases: ["_http._tcp"],
        port: 8080,
      },
      devices: [{ interface: "wlan0", type: "wifi", state: "active" }],
    },
    transaction: { current: null, latest: null },
    mutation_capability: {
      enabled: false,
      disabled_reason: "not_enabled",
      operations: ["apply", "retry", "forget"],
      idempotency_key_required: true,
      secret_handling: "opaque_credential_reference_only",
      active_state_policy: "idle_only",
    },
    concurrency_capability: {
      rescue_ap_required: true,
      same_phy_ap_sta: "unverified",
      exclusive_client_failure_timeout_seconds: 10,
      max_managed_interfaces: 1,
      max_ap_interfaces: 1,
    },
    ...overrides,
  };
}

test("网络响应校验执行 v4 跨字段事务与凭据约束", () => {
  const accepted = networkTransaction();
  const receipt = {
    schema: "ylx.network-transaction-receipt.v1",
    accepted_at: accepted.accepted_at,
    transaction: accepted,
  };
  const credential = {
    schema: "ylx.network-credential-receipt.v1",
    credential_ref: "cred-unit-test",
    issued_at: "2026-08-12T02:25:02Z",
    expires_at: "2026-08-12T02:25:32Z",
    ttl_seconds: 30,
    single_use: true,
  };

  expect(isNetworkTransactionReceipt(receipt)).toBe(true);
  expect(isNetworkCredentialReceipt(credential)).toBe(true);
  expect(
    isNetworkTransactionReceipt({ ...receipt, accepted_at: "2026-08-12T02:25:03Z" }),
  ).toBe(false);
  expect(
    isNetworkTransactionReceipt({
      ...receipt,
      transaction: networkTransaction({ status: "running", stage: "prepared" }),
    }),
  ).toBe(false);
  expect(
    isNetworkCredentialReceipt({ ...credential, expires_at: "2026-08-12T02:25:31Z" }),
  ).toBe(false);

  const rescuedWithDeadline = networkTransaction({
    status: "rescued",
    stage: "rescued",
    deadline: { time_base: "device_monotonic", deadline_ns: 10, remaining_seconds: 0 },
    recovery_action: "reconnect_rescue_ap",
    error: { code: "dhcp_timeout", message: "timed out", retryable: true },
  });
  expect(
    isNetworkStatus(
      networkStatus(2, { transaction: { current: null, latest: rescuedWithDeadline } }),
    ),
  ).toBe(false);
  expect(
    isNetworkStatus(
      networkStatus(2, {
        transaction: {
          current: networkTransaction({ status: "committed", stage: "committed" }),
          latest: null,
        },
      }),
    ),
  ).toBe(false);
});

test("同 authority 下旧 network snapshot 不能覆盖更高 revision 状态", () => {
  const newer = networkStatus(5);
  let state = reduceState(initialState, { type: "network.loaded", payload: newer });
  state = reduceState(state, { type: "network.loaded", payload: networkStatus(3) });

  expect(state.networkStatus).toBe(newer);
  expect(state.networkStatus?.source_revision).toBe(5);
});

const replacementFocus = {
  schema: "ylx.camera-focus.v1",
  value: 0,
  minimum: 0,
  maximum: 255,
  step: 1,
  default: 32,
  auto_supported: true,
  auto_enabled: false,
};

test("deviceApi public export is runtime immutable", () => {
  const originalGetCameraFocus = deviceApi.getCameraFocus;
  const originalSetCameraFocus = deviceApi.setCameraFocus;
  const replacementGetCameraFocus = async () => replacementFocus;
  const replacementSetCameraFocus = async () => replacementFocus;

  const expectFocusMethodsIntact = () => {
    expect(deviceApi.getCameraFocus).toBe(originalGetCameraFocus);
    expect(deviceApi.setCameraFocus).toBe(originalSetCameraFocus);
  };

  try {
    expect(Object.isFrozen(deviceApi)).toBe(true);

    expect(() => {
      deviceApi.getCameraFocus = replacementGetCameraFocus;
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      deviceApi.setCameraFocus = replacementSetCameraFocus;
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      Object.defineProperty(deviceApi, "getCameraFocus", { value: replacementGetCameraFocus });
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      Object.defineProperty(deviceApi, "setCameraFocus", { value: replacementSetCameraFocus });
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      Object.assign(deviceApi, {
        getCameraFocus: replacementGetCameraFocus,
        setCameraFocus: replacementSetCameraFocus,
      });
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      delete deviceApi.getCameraFocus;
    }).toThrow(TypeError);
    expectFocusMethodsIntact();

    expect(() => {
      delete deviceApi.setCameraFocus;
    }).toThrow(TypeError);
    expectFocusMethodsIntact();
  } finally {
    if (!Object.isFrozen(deviceApi)) {
      Object.defineProperties(deviceApi, {
        getCameraFocus: {
          configurable: true,
          enumerable: true,
          value: originalGetCameraFocus,
          writable: true,
        },
        setCameraFocus: {
          configurable: true,
          enumerable: true,
          value: originalSetCameraFocus,
          writable: true,
        },
      });
    }
  }
});

test("deviceApi camera focus methods still use the v4 focus route", async () => {
  const originalFetch = globalThis.fetch;
  /** @type {Array<{url: string, method: string, body: unknown}>} */
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(replacementFocus), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status: 200,
    });
  };

  try {
    await expect(deviceApi.getCameraFocus()).resolves.toEqual(replacementFocus);
    await expect(deviceApi.setCameraFocus({ value: 64 })).resolves.toEqual(replacementFocus);
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requests).toEqual([
    { url: "/api/v4/camera/focus", method: "GET", body: null },
    {
      url: "/api/v4/camera/focus",
      method: "POST",
      body: { schema: "ylx.camera-focus-set.v1", value: 64 },
    },
  ]);
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
        camera: {
          schema: "ylx.camera-connection.v1",
          state: "connected",
        },
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
      calibration_capture: {
        supported: true,
        enabled: true,
        disabled_reason: null,
        required_video_layout: "split-eyes",
      },
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
