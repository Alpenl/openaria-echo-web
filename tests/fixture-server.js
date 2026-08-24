// @ts-check

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
/** @typedef {import("node:http").IncomingMessage} IncomingMessage */
/** @typedef {import("node:http").ServerResponse} ServerResponse */
/** @typedef {import("../src/api/types.ts").CaptureStatus} CaptureStatus */
/** @typedef {import("../src/api/types.ts").CameraFocusStatus} CameraFocusStatus */
/** @typedef {import("../src/api/types.ts").DeviceDescriptor} DeviceDescriptor */
/** @typedef {import("../src/api/types.ts").DeviceRuntime} DeviceRuntime */
/** @typedef {import("../src/api/types.ts").NetworkStatus} NetworkStatus */
/** @typedef {import("../src/api/types.ts").NetworkTransaction} NetworkTransaction */
/** @typedef {import("../src/api/types.ts").SafeSwapReceipt} SafeSwapReceipt */
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 测试跑的是真实构建产物：Conductor 托管什么，这里就服务什么。
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(repositoryRoot, "dist");
const fixtureRoot = resolve(repositoryRoot, "tests/fixtures");
const canonicalDiagnosticEvent = JSON.parse(
  await readFile(resolve(fixtureRoot, "capture-event.json"), "utf8"),
);
const canonicalFailedRecordingState = JSON.parse(
  await readFile(resolve(fixtureRoot, "recording-state-failed.json"), "utf8"),
);
const canonicalCaptureBusyProblem = JSON.parse(
  await readFile(resolve(fixtureRoot, "error-capture-busy.json"), "utf8"),
);
/** @type {Record<string, string>} */
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const gibibyte = 1024 ** 3;
const authorityEpoch = "4fa85f64-5717-4562-b3fc-2c963f66afa6";
const deviceId = "a7d9b620-987b-4d35-89c1-5511f8036aed";
const volumeId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const sessionId = "01989f6a-2c00-7a1b-8c2d-3e4f50617283";
const takeId = "01989f6a-2c00-7a1b-8c2d-3e4f50617284";
const generationId = "7d516b70-d8ab-47d1-b2dc-5b1250138789";
const historicalSessionId = "01989f6a-2c00-7a1b-8c2d-3e4f50617288";
const historicalTakeId = "01989f6a-2c00-7a1b-8c2d-3e4f50617289";
const nextAuthorityEpoch = "5fa85f64-5717-4562-b3fc-2c963f66afa6";
const nextSessionId = "01989f6a-2c00-7a1b-8c2d-3e4f50617290";
const nextTakeId = "01989f6a-2c00-7a1b-8c2d-3e4f50617291";
const nextGenerationId = "8d516b70-d8ab-47d1-b2dc-5b1250138789";
const manifestId = "01989f6a-2c00-7a1b-8c2d-3e4f50617285";
const sealedSessionId = "01989f6a-2c00-7a1b-8c2d-3e4f50617286";
const sealedTakeId = "01989f6a-2c00-7a1b-8c2d-3e4f50617287";
const previewJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/Iaf/2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64",
);

/**
 * @typedef {object} Fixture
 * @property {DeviceDescriptor & Record<string, unknown>} device
 * @property {CaptureStatus} snapshot
 * @property {NetworkStatus} networkStatus
 * @property {{schema: string, items: unknown[], diagnostics: unknown[], next_cursor: string | null}} sessions
 * @property {number} nextDeliveryId
 * @property {number} commandDelayMs
 * @property {boolean} stopReturns204
 * @property {boolean} startProblem
 * @property {boolean} stopProblem
 * @property {boolean} eventsUnavailable
 * @property {boolean} sessionsVolumeUnavailable
 * @property {boolean} networkUnavailable
 * @property {boolean} cameraConnected
 * @property {Set<string>} networkCredentialRefs
 * @property {number} nextNetworkCredential
 * @property {number} sessionsDelayMs
 * @property {number} sessionPublicationDelayMs
 * @property {number} eventSnapshotDelayMs
 * @property {number} previewDelayMs
 * @property {number} previewRequests
 * @property {Set<number>} previewActive
 * @property {Array<Record<string, unknown>>} previewTimeline
 * @property {number} previewMaxConcurrent
 * @property {boolean} requireBearer
 * @property {Array<{path: string, authorization: string | null, lastEventId: string | null, idempotencyKey: string | null, body?: unknown}>} apiRequests
 * @property {{schema: "ylx.safe-swap-receipt-resource.v3", receipt: SafeSwapReceipt} | null} safeSwapResource
 * @property {ReturnType<typeof captureEvent> | null} staleSafeSwapEvent
 * @property {number} captureSequence
 */

/** @returns {CameraFocusStatus} */
const makeCameraFocusStatus = () => ({
  schema: "ylx.camera-focus.v1",
  value: 42,
  minimum: 0,
  maximum: 255,
  step: 1,
  default: 32,
  auto_supported: true,
  auto_enabled: false,
});

/** @param {DeviceRuntime["network"]} network */
function networkDevices(network) {
  const wireless = network.wifi_client.interface ? network.wifi_client : network.ap;
  return [
    {
      interface: wireless.interface ?? "wlan0",
      type: "wifi",
      state: wireless.state,
    },
    { interface: network.wired.interface ?? "eth0", type: "ethernet", state: network.wired.state },
  ];
}

/** @param {Partial<NetworkTransaction>} [overrides] @returns {NetworkTransaction} */
function makeNetworkTransaction(overrides = {}) {
  return {
    schema: "ylx.network-transaction.v1",
    authority_epoch: authorityEpoch,
    source_revision: 2,
    transaction_id: "0198d2a0-41a0-7b7a-a751-0e86a39d4db1",
    operation: "apply",
    status: "rescued",
    stage: "falling_back",
    desired: {
      mode: "wifi-client",
      wifi_client: {
        ssid: "Lab WiFi",
        security: "wpa2-personal",
        credential_state: "stored",
      },
      ethernet: null,
    },
    accepted_at: "2026-08-12T02:25:02Z",
    updated_at: "2026-08-12T02:25:12Z",
    deadline: null,
    recovery_action: "reconnect_rescue_ap",
    rescue: {
      ap_validated: true,
      fallback_mode: "hotspot",
      failure_trigger_seconds: 10,
    },
    error: {
      code: "dhcp_timeout",
      message: "candidate Wi-Fi failed before commit",
      retryable: true,
    },
    ...overrides,
  };
}

/** @param {DeviceRuntime} runtime @param {number} [sourceRevision] @returns {NetworkStatus} */
function makeNetworkStatusFromRuntime(runtime, sourceRevision = 1) {
  return {
    schema: "ylx.network-status.v1",
    authority_epoch: authorityEpoch,
    source_revision: sourceRevision,
    observed_at: runtime.observed_at,
    saved: false,
    verified: false,
    desired: {
      mode: "hotspot",
      wifi_client: null,
      ethernet: null,
    },
    observed: {
      ap: structuredClone(runtime.network.ap),
      wifi_client: structuredClone(runtime.network.wifi_client),
      wired: structuredClone(runtime.network.wired),
      default_route: runtime.network.default_route,
      mdns: {
        hostname: "rp-ylx.local",
        service: "_ylx-capture._tcp",
        aliases: ["_http._tcp"],
        port: 8080,
      },
      devices: networkDevices(runtime.network),
    },
    transaction: {
      current: null,
      latest: null,
    },
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
  };
}

/** @returns {NetworkStatus} */
const makeNetworkStatus = () => makeNetworkStatusFromRuntime(makeRuntime());

/** @returns {DeviceRuntime} */
const makeRuntime = () => ({
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
  live_imu: {
    session_id: sessionId,
    clock: {
      time_base: "host_monotonic",
      timestamp_ns: 4_250_000_000,
    },
    raw: {
      units: "raw_int16",
      accelerometer: { x: 12, y: -8, z: 979 },
      gyroscope: { x: 1, y: -2, z: 5 },
    },
    sync: { quality: "good" },
  },
  camera: {
    schema: "ylx.camera-connection.v1",
    state: "connected",
  },
  camera_focus: makeCameraFocusStatus(),
});

/** @returns {DeviceDescriptor & Record<string, unknown>} */
const makeDevice = () => ({
  schema: "ylx.device.v4",
  device: { device_id: deviceId, device_label: "YLX-A1B2C3D4" },
  hardware_fingerprint: `sha256:${"a".repeat(64)}`,
  api_version: "4.0",
  build: {
    package_version: "0.5.0-dev",
    commit: "b".repeat(40),
    build_id: "fixture-rdk-x5",
  },
  security_profile: "lab",
  capabilities: {
    capture: true,
    preview: true,
    range_download: true,
    network_mutation: true,
  },
  storage: {
    volume_id: volumeId,
    total_bytes: 128 * gibibyte,
    available_bytes: 82 * gibibyte,
    writable: true,
  },
  runtime: makeRuntime(),
});

/** @returns {CaptureStatus} */
const makeSnapshot = () => ({
  schema: "ylx.capture-status.v4",
  authority_epoch: authorityEpoch,
  source_revision: 1,
  snapshot: {
    schema: "ylx.capture-snapshot-event.v4",
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: null,
    runtime: makeRuntime(),
  },
});

/** @returns {Fixture} */
function makeFixture() {
  return {
    device: makeDevice(),
    snapshot: makeSnapshot(),
    networkStatus: makeNetworkStatus(),
    sessions: {
      schema: "ylx.session-list.v2",
      items: [
        {
          session_id: sealedSessionId,
          producer_outcome: "sealed",
          take_id: sealedTakeId,
          take_sequence: 1,
          continuation_of: null,
          display_name: "入口标定",
          device: { device_id: deviceId, device_label: "YLX-A1B2C3D4" },
          started_at: "2026-08-12T01:00:00Z",
          ended_at: "2026-08-12T01:02:05Z",
          duration_seconds: 125,
          total_bytes: 3 * gibibyte,
          verification: {
            actor: "gateway",
            validator: {
              name: "rp-ylx-session-validator",
              version: "0.5.0",
              build_sha256: "d".repeat(64),
            },
            manifest_sha256: "e".repeat(64),
            verified_at: "2026-08-12T01:02:10Z",
            verdict: "usable",
            diagnostics: [],
          },
        },
        {
          session_id: historicalSessionId,
          producer_outcome: "sealed",
          take_id: historicalTakeId,
          take_sequence: 2,
          continuation_of: sealedSessionId,
          display_name: "长名称用于移动端布局验证-abcdefghijklmnop-第二段采集",
          device: { device_id: deviceId, device_label: "YLX-A1B2C3D4" },
          started_at: "2026-08-12T01:10:00Z",
          ended_at: "2026-08-12T01:11:00Z",
          duration_seconds: 60,
          total_bytes: 2 * gibibyte,
          verification: null,
        },
      ],
      diagnostics: [
        {
          quarantine_id: "e4a4a3ca-568f-4b70-b68d-b36ffbd88602",
          code: "manifest_unreadable",
          observed_at: "2026-08-12T01:20:00Z",
          message: "发现一个无法读取的会话清单，已隔离",
        },
      ],
      next_cursor: null,
    },
    nextDeliveryId: 1,
    commandDelayMs: 0,
    stopReturns204: false,
    startProblem: false,
    stopProblem: false,
    eventsUnavailable: false,
    sessionsVolumeUnavailable: false,
    networkUnavailable: false,
    cameraConnected: true,
    networkCredentialRefs: new Set(),
    nextNetworkCredential: 1,
    sessionsDelayMs: 0,
    sessionPublicationDelayMs: 0,
    eventSnapshotDelayMs: 0,
    previewDelayMs: 20,
    previewRequests: 0,
    previewActive: new Set(),
    previewTimeline: [],
    previewMaxConcurrent: 0,
    requireBearer: false,
    apiRequests: [],
    safeSwapResource: null,
    staleSafeSwapEvent: null,
    captureSequence: 0,
  };
}

let fixture = makeFixture();
/** @type {Set<ServerResponse>} */
let eventResponses = new Set();
/** @type {Set<ServerResponse>} */
let networkEventResponses = new Set();

function resetFixture() {
  for (const response of eventResponses) {
    response.end();
  }
  eventResponses = new Set();
  for (const response of networkEventResponses) {
    response.end();
  }
  networkEventResponses = new Set();
  fixture = makeFixture();
}

resetFixture();

/** @param {ServerResponse} response @param {number} status @param {unknown} body */
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

/** @param {string} type @param {unknown} data @param {string | null} [subjectSessionId] */
function captureEvent(type, data, subjectSessionId = null) {
  const deliveryId = String(fixture.nextDeliveryId++);
  return {
    schema: "ylx.capture-event.v4",
    sse_delivery_id: deliveryId,
    authority_epoch: fixture.snapshot.authority_epoch,
    source_revision: fixture.snapshot.source_revision,
    type,
    occurred_at: "2026-08-12T02:25:01Z",
    session_id: subjectSessionId,
    data,
  };
}

/** @param {string} [type] @param {NetworkStatus | NetworkTransaction | null} [data] */
function networkEvent(type = "snapshot", data = null) {
  const eventData = data ?? fixture.networkStatus;
  const deliveryId = String(fixture.nextDeliveryId++);
  return {
    schema: "ylx.network-event.v1",
    sse_delivery_id: deliveryId,
    authority_epoch: eventData.authority_epoch,
    source_revision: eventData.source_revision,
    occurred_at: "2026-08-12T02:25:01Z",
    type,
    transaction_id:
      eventData.schema === "ylx.network-transaction.v1" ? eventData.transaction_id : null,
    data: eventData,
  };
}

/** @param {ServerResponse} response @param {ReturnType<typeof captureEvent>} event */
function writeEvent(response, event) {
  response.write(`id: ${event.sse_delivery_id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** @param {ServerResponse} response @param {ReturnType<typeof networkEvent>} event */
function writeNetworkEvent(response, event) {
  response.write(`id: ${event.sse_delivery_id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcastSnapshot() {
  const recording =
    fixture.snapshot.snapshot.active_recording ??
    fixture.snapshot.snapshot.retained_unsuccessful;
  const event = captureEvent(
    "snapshot",
    fixture.snapshot.snapshot,
    recording?.recording_state.session_id ?? null,
  );
  for (const response of eventResponses) {
    writeEvent(response, event);
  }
}

function broadcastNetworkSnapshot() {
  const event = networkEvent("snapshot");
  for (const response of networkEventResponses) {
    writeNetworkEvent(response, event);
  }
}

/** @param {NetworkTransaction} transaction */
function broadcastNetworkTransaction(transaction) {
  const event = networkEvent("transaction", transaction);
  for (const response of networkEventResponses) {
    writeNetworkEvent(response, event);
  }
}

/** @param {boolean} valid @param {string} displayName */
function broadcastStateEvent(valid, displayName) {
  setRecording(displayName);
  const recording = fixture.snapshot.snapshot.active_recording;
  if (!recording) {
    throw new Error("fixture 未建立 state 事件录制");
  }
  const eventData = valid
    ? {
        schema: "ylx.capture-state-event.v2",
        state: recording.recording_state.state,
        volume_id: recording.recording_state.storage.volume_id,
        generation_id: recording.generation_id,
      }
    : {
        schema: "ylx.capture-state-event.v2",
        state: "idle",
        volume_id: recording.recording_state.storage.volume_id,
        generation_id: recording.generation_id,
      };
  broadcastEvent(captureEvent("state", eventData, recording.recording_state.session_id));
}

function broadcastTerminalStateEvent() {
  const recording = fixture.snapshot.snapshot.active_recording;
  if (!recording) {
    throw new Error("fixture 未建立终态 state 事件录制");
  }
  const sessionId = recording.recording_state.session_id;
  const eventData = {
    schema: "ylx.capture-state-event.v2",
    state: "verifying",
    volume_id: recording.recording_state.storage.volume_id,
    generation_id: recording.generation_id,
  };
  setIdleAfterUserStop();
  broadcastEvent(captureEvent("state", eventData, sessionId));
}

/** @param {ReturnType<typeof captureEvent>} event */
function broadcastEvent(event) {
  for (const response of eventResponses) {
    writeEvent(response, event);
  }
}

/** @returns {CameraFocusStatus | null} */
function currentCameraFocus() {
  return fixture.snapshot.snapshot.runtime.camera_focus ?? fixture.device.runtime.camera_focus;
}

/** @param {{value?: unknown, auto_enabled?: unknown}} body @returns {CameraFocusStatus | null} */
function setCameraFocus(body) {
  const current = currentCameraFocus();
  if (!current) {
    return null;
  }
  const next = { ...current };
  if (body.auto_enabled === true) {
    next.auto_enabled = true;
  } else if (typeof body.value === "number" && Number.isInteger(body.value)) {
    next.value = body.value;
    if (next.auto_supported) {
      next.auto_enabled = false;
    }
  }
  fixture.device.runtime = {
    ...fixture.device.runtime,
    camera_focus: { ...next },
  };
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    runtime: {
      ...fixture.snapshot.snapshot.runtime,
      camera_focus: { ...next },
    },
  };
  return next;
}

/** @param {boolean} supported */
function setCameraFocusAutoSupported(supported) {
  const current = currentCameraFocus();
  if (!current) {
    return;
  }
  const next = {
    ...current,
    auto_supported: supported,
    auto_enabled: supported ? false : null,
  };
  fixture.device.runtime = {
    ...fixture.device.runtime,
    camera_focus: { ...next },
  };
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    runtime: {
      ...fixture.snapshot.snapshot.runtime,
      camera_focus: { ...next },
    },
  };
}

/**
 * @param {DeviceRuntime["network"]} network
 * @param {DeviceRuntime["connection_method"]} connectionMethod
 */
function setNetworkRuntime(network, connectionMethod) {
  fixture.device.runtime = {
    ...fixture.device.runtime,
    connection_method: connectionMethod,
    network: structuredClone(network),
  };
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    runtime: {
      ...fixture.snapshot.snapshot.runtime,
      connection_method: connectionMethod,
      network: structuredClone(network),
    },
  };
  const previous = fixture.networkStatus;
  fixture.networkStatus = {
    ...makeNetworkStatusFromRuntime(fixture.device.runtime, previous.source_revision + 1),
    saved: previous.saved,
    verified: previous.verified,
    desired: previous.desired,
    transaction: previous.transaction,
    mutation_capability: previous.mutation_capability,
  };
}

/** @param {IncomingMessage} request @returns {Promise<unknown | null>} */
async function readOptionalJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** @param {IncomingMessage} request @returns {Promise<unknown>} */
async function readJson(request) {
  const body = await readOptionalJson(request);
  if (body === null) {
    throw new Error("missing JSON body");
  }
  return body;
}

const SECRET_BODY_KEYS = new Set([
  "credential_ref",
  "passphrase",
  "password",
  "psk",
  "secret",
  "token",
]);

/** @param {unknown} value @returns {unknown} */
function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_BODY_KEYS.has(key.toLowerCase()) ? "<redacted>" : redactSecrets(entry),
    ]),
  );
}

/**
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 * @param {{body?: unknown} | null} apiRequest
 */
async function failClosedNetworkMutation(request, response, apiRequest) {
  const body = await readOptionalJson(request);
  if (apiRequest) {
    apiRequest.body = redactSecrets(body);
  }
  sendJson(response, 503, {
    schema: "ylx.api-error.v2",
    error: {
      code: "network_mutation_unavailable",
      message: "网络变更控制器未启用；Echo fixture 保持 fail-closed",
      request_id: "6f214fbd-88c0-4820-a956-2044b1b0488f",
      retryable: false,
      details: {
        mutation_enabled: false,
        accepted_operations: ["apply", "retry", "forget"],
      },
    },
  });
}

function networkProblem(response, status, code, message) {
  sendJson(response, status, {
    schema: "ylx.api-error.v2",
    error: {
      code,
      message,
      request_id: "6f214fbd-88c0-4820-a956-2044b1b0488f",
      retryable: status >= 500,
    },
  });
}

function makeNetworkScan() {
  return {
    schema: "ylx.network-scan.v1",
    authority_epoch: fixture.networkStatus.authority_epoch,
    source_revision: fixture.networkStatus.source_revision,
    scanned_at: "2026-08-23T10:30:00Z",
    networks: [
      {
        ssid: "Lab WiFi",
        hidden: false,
        security: "wpa2-personal",
        signal_dbm: -42,
        credential_required: true,
      },
      {
        ssid: "Open Lab",
        hidden: false,
        security: "open",
        signal_dbm: -61,
        credential_required: false,
      },
      {
        ssid: null,
        hidden: true,
        security: "wpa3-personal",
        signal_dbm: -75,
        credential_required: true,
      },
    ],
  };
}

function nextNetworkTransactionId() {
  const suffix = (0xe86a39d4db0 + fixture.nextNetworkCredential).toString(16).padStart(12, "0");
  fixture.nextNetworkCredential += 1;
  return `0198d2a0-41a0-7b7a-a751-${suffix}`;
}

function acceptFixtureNetworkTransaction(operation, desired) {
  const sourceRevision = fixture.networkStatus.source_revision + 1;
  const transaction = makeNetworkTransaction({
    authority_epoch: fixture.networkStatus.authority_epoch,
    source_revision: sourceRevision,
    transaction_id: nextNetworkTransactionId(),
    operation,
    status: "accepted",
    stage: "accepted",
    desired,
    accepted_at: "2026-08-23T10:31:00Z",
    updated_at: "2026-08-23T10:31:00Z",
    deadline: null,
    recovery_action: "await_device",
    rescue: {
      ap_validated: true,
      fallback_mode: "hotspot",
      failure_trigger_seconds: 10,
    },
    error: null,
  });
  fixture.networkStatus = {
    ...fixture.networkStatus,
    source_revision: sourceRevision,
    observed_at: "2026-08-23T10:31:00Z",
    saved: desired.mode === "wifi-client",
    verified: false,
    desired,
    transaction: { current: transaction, latest: fixture.networkStatus.transaction.latest },
  };
  return {
    schema: "ylx.network-transaction-receipt.v1",
    accepted_at: transaction.accepted_at,
    transaction,
  };
}

/** @param {string} displayName */
function setRecording(displayName) {
  fixture.snapshot.source_revision += 1;
  const sequence = fixture.captureSequence++;
  const activeSessionId =
    sequence === 0 ? sessionId : sequence === 1 ? nextSessionId : sequenceId(0x7300 + sequence * 2);
  const activeTakeId =
    sequence === 0 ? takeId : sequence === 1 ? nextTakeId : sequenceId(0x7301 + sequence * 2);
  const activeGenerationId =
    sequence === 0
      ? generationId
      : sequence === 1
        ? nextGenerationId
        : `7d516b70-d8ab-47d1-b2dc-5b125013${(0x8800 + sequence).toString(16).padStart(4, "0")}`;
  const recordingState = {
    schema: "ylx.recording-state.v1",
    state: "recording",
    authority_epoch: fixture.snapshot.authority_epoch,
    state_revision: fixture.snapshot.source_revision,
    updated_at: "2026-08-12T02:25:01Z",
    session_id: activeSessionId,
    take_id: activeTakeId,
    display_name: displayName,
    device: fixture.device.device,
    storage: {
      volume_id: volumeId,
      status: "mounted",
      writable: true,
      remaining_bytes: fixture.device.storage.available_bytes,
    },
    progress: {
      elapsed_seconds: 0,
      captured_frames: 0,
      bytes_written: 0,
    },
    diagnostics: [],
  };
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "recording",
    active_recording: {
      generation_id: activeGenerationId,
      recording_state: recordingState,
    },
    retained_unsuccessful: null,
  };
}

/** @param {number} suffix */
function sequenceId(suffix) {
  return `01989f6a-2c00-7a1b-8c2d-3e4f5061${suffix.toString(16).padStart(4, "0")}`;
}

function setFinalizing() {
  const current = fixture.snapshot.snapshot.active_recording?.recording_state;
  if (!current) {
    return;
  }
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "finalizing",
    active_recording: {
      generation_id: generationId,
      recording_state: {
        ...current,
        state: "finalizing",
        state_revision: fixture.snapshot.source_revision,
        updated_at: "2026-08-12T02:25:02Z",
      },
    },
  };
}

function setIdleAfterUserStop() {
  const current = fixture.snapshot.snapshot.active_recording?.recording_state;
  if (current) {
    const targetFixture = fixture;
    const session = {
      session_id: current.session_id,
      producer_outcome: "sealed",
      take_id: current.take_id,
      take_sequence: targetFixture.sessions.items.length + 1,
      continuation_of: null,
      display_name: current.display_name,
      device: current.device,
      started_at: "2026-08-12T02:25:01Z",
      ended_at: "2026-08-12T02:25:03Z",
      duration_seconds: Math.max(1, Math.round(current.progress.elapsed_seconds)),
      total_bytes: Math.max(64 * 1024 * 1024, current.progress.bytes_written),
      verification: null,
    };
    if (targetFixture.sessionPublicationDelayMs > 0) {
      setTimeout(() => targetFixture.sessions.items.unshift(session), targetFixture.sessionPublicationDelayMs);
    } else {
      targetFixture.sessions.items.unshift(session);
    }
  }
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: null,
  };
}

function setFailed() {
  fixture.snapshot.source_revision += 1;
  const recordingState = structuredClone(canonicalFailedRecordingState);
  recordingState.authority_epoch = fixture.snapshot.authority_epoch;
  recordingState.state_revision = fixture.snapshot.source_revision;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: {
      generation_id: generationId,
      recording_state: recordingState,
    },
  };
  broadcastSnapshot();
}

function setInterrupted() {
  fixture.snapshot.source_revision += 1;
  const recordingState = structuredClone(canonicalFailedRecordingState);
  recordingState.authority_epoch = fixture.snapshot.authority_epoch;
  recordingState.state = "recoverable";
  recordingState.state_revision = fixture.snapshot.source_revision;
  recordingState.updated_at = "2026-08-20T21:25:07.063654Z";
  recordingState.session_id = "01989f6a-2d00-7a1b-8c2d-3e4f50617283";
  recordingState.take_id = "01989f6a-2d00-7a1b-8c2d-3e4f50617284";
  recordingState.display_name = "acceptance-31d70d8-fault-daemon-kill";
  recordingState.storage.writable = true;
  recordingState.progress = {
    elapsed_seconds: 0.001594,
    captured_frames: 0,
    bytes_written: 0,
  };
  recordingState.diagnostics = [
    {
      code: "process_interrupted",
      severity: "error",
      message: "daemon 重启时发现未完成封存的会话",
      at: "2026-08-20T21:25:07.063654Z",
      recoverable: true,
    },
  ];
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: {
      generation_id: generationId,
      recording_state: recordingState,
    },
  };
  broadcastSnapshot();
}

function advanceProgress() {
  const current = fixture.snapshot.snapshot.active_recording?.recording_state;
  if (!current) {
    return;
  }
  const repeated = current.progress.elapsed_seconds >= 12.4;
  const elapsedSeconds = repeated ? 12.6 : 12.4;
  const capturedFrames = repeated ? 756 : 744;
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    active_recording: {
      generation_id: generationId,
      recording_state: {
        ...current,
        state_revision: fixture.snapshot.source_revision,
        updated_at: "2026-08-12T02:25:13Z",
        progress: {
          elapsed_seconds: elapsedSeconds,
          captured_frames: capturedFrames,
          bytes_written: 44_040_192,
        },
      },
    },
  };
  broadcastEvent(
    captureEvent(
      "progress",
      {
        schema: "ylx.capture-progress-event.v2",
        phase: "recording",
        elapsed_seconds: elapsedSeconds,
        completed_units: capturedFrames,
        total_units: null,
        unit: "frames",
      },
      sessionId,
    ),
  );
}

function completeSafeSwap() {
  /** @type {SafeSwapReceipt} */
  const receipt = {
    schema: "ylx.safe-swap-receipt.v3",
    session_id: sessionId,
    volume_id: volumeId,
    generation_id: generationId,
    manifest_id: manifestId,
    manifest_sha256: "c".repeat(64),
    sealed_at: "2026-08-12T02:25:03Z",
    released_at: "2026-08-12T02:25:04Z",
    release_state: "device-released",
    open_handle_count: 0,
  };
  fixture.safeSwapResource = {
    schema: "ylx.safe-swap-receipt-resource.v3",
    receipt,
  };
  fixture.snapshot.source_revision += 1;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: null,
  };
  broadcastSnapshot();
  fixture.staleSafeSwapEvent = captureEvent("safe_swap", receipt, sessionId);
  broadcastEvent(fixture.staleSafeSwapEvent);
}

function completeSafeSwapWithGap() {
  /** @type {SafeSwapReceipt} */
  const receipt = {
    schema: "ylx.safe-swap-receipt.v3",
    session_id: sessionId,
    volume_id: volumeId,
    generation_id: generationId,
    manifest_id: manifestId,
    manifest_sha256: "c".repeat(64),
    sealed_at: "2026-08-12T02:25:03Z",
    released_at: "2026-08-12T02:25:04Z",
    release_state: "device-released",
    open_handle_count: 0,
  };
  fixture.safeSwapResource = {
    schema: "ylx.safe-swap-receipt-resource.v3",
    receipt,
  };
  fixture.snapshot.source_revision += 2;
  fixture.snapshot.snapshot = {
    ...fixture.snapshot.snapshot,
    device_state: "idle",
    active_recording: null,
    retained_unsuccessful: null,
  };
  broadcastEvent(captureEvent("safe_swap", receipt, sessionId));
}

/** @param {"mounted" | "open-handles"} unsafeState */
function broadcastUnsafeSafeSwap(unsafeState) {
  const receipt = {
    schema: "ylx.safe-swap-receipt.v3",
    session_id: sessionId,
    volume_id: volumeId,
    generation_id: generationId,
    manifest_id: manifestId,
    manifest_sha256: "c".repeat(64),
    sealed_at: "2026-08-12T02:25:03Z",
    released_at: "2026-08-12T02:25:04Z",
    release_state: unsafeState === "mounted" ? "mounted" : "unmounted",
    open_handle_count: unsafeState === "open-handles" ? 1 : 0,
  };
  broadcastEvent(captureEvent("safe_swap", receipt, sessionId));
}

function startNewAuthorityRecording() {
  fixture.safeSwapResource = null;
  fixture.snapshot = makeSnapshot();
  fixture.snapshot.authority_epoch = nextAuthorityEpoch;
  fixture.snapshot.source_revision = 1;
  setRecording("新 authority 录制");
  const recording = fixture.snapshot.snapshot.active_recording;
  if (!recording) {
    throw new Error("fixture 未建立新录制");
  }
  recording.generation_id = nextGenerationId;
  recording.recording_state = {
    ...recording.recording_state,
    authority_epoch: nextAuthorityEpoch,
    session_id: nextSessionId,
    take_id: nextTakeId,
  };
  broadcastSnapshot();
}

/** @param {boolean} [broadcast] */
function mutateRelatedResources(broadcast = true) {
  fixture.device.storage.available_bytes = 64 * gibibyte;
  fixture.sessions.items.unshift({
    session_id: "01989f6a-2c00-7a1b-8c2d-3e4f50617299",
    producer_outcome: "sealed",
    take_id: "01989f6a-2c00-7a1b-8c2d-3e4f50617300",
    take_sequence: 3,
    continuation_of: null,
    display_name: "外部客户端封存",
    device: fixture.device.device,
    started_at: "2026-08-12T02:30:00Z",
    ended_at: "2026-08-12T02:31:00Z",
    duration_seconds: 60,
    total_bytes: gibibyte,
    verification: null,
  });
  fixture.snapshot.source_revision += 1;
  if (broadcast) {
    broadcastSnapshot();
  }
}

/** @param {IncomingMessage} request @param {ServerResponse} response */
function rejectMissingBearer(request, response) {
  if (!fixture.requireBearer || request.headers.authorization === "Bearer customer-token") {
    return false;
  }
  sendJson(response, 401, {
    schema: "ylx.api-error.v2",
    error: {
      code: "authentication_required",
      message: "需要设备访问令牌",
      request_id: "d52bed36-3a92-42f1-b653-22694a231db6",
      retryable: false,
    },
  });
  return true;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
  if (url.pathname === "/__ready") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/reset" && request.method === "POST") {
    resetFixture();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/config" && request.method === "POST") {
    const config = /** @type {{commandDelayMs?: number, previewDelayMs?: number, requireBearer?: boolean, stopReturns204?: boolean, startProblem?: boolean, stopProblem?: boolean, eventsUnavailable?: boolean, sessionsVolumeUnavailable?: boolean, networkMutation?: boolean, networkUnavailable?: boolean, cameraConnected?: boolean, sessionsDelayMs?: number, sessionPublicationDelayMs?: number, eventSnapshotDelayMs?: number, cameraFocusAutoSupported?: boolean, apiVersion?: string}} */ (
      await readJson(request)
    );
    if (typeof config.apiVersion === "string") {
      fixture.device.api_version = config.apiVersion;
    }
    if (Number.isFinite(config.commandDelayMs)) {
      fixture.commandDelayMs = Number(config.commandDelayMs);
    }
    if (typeof config.requireBearer === "boolean") {
      fixture.requireBearer = config.requireBearer;
      fixture.device.security_profile = config.requireBearer ? "customer" : "lab";
    }
    if (Number.isFinite(config.previewDelayMs)) {
      fixture.previewDelayMs = Number(config.previewDelayMs);
    }
    if (typeof config.stopReturns204 === "boolean") {
      fixture.stopReturns204 = config.stopReturns204;
    }
    if (typeof config.startProblem === "boolean") {
      fixture.startProblem = config.startProblem;
    }
    if (typeof config.stopProblem === "boolean") {
      fixture.stopProblem = config.stopProblem;
    }
    if (typeof config.eventsUnavailable === "boolean") {
      fixture.eventsUnavailable = config.eventsUnavailable;
    }
    if (typeof config.networkMutation === "boolean") {
      fixture.device.capabilities.network_mutation = config.networkMutation;
      fixture.networkStatus = {
        ...fixture.networkStatus,
        mutation_capability: {
          ...fixture.networkStatus.mutation_capability,
          enabled: config.networkMutation,
          disabled_reason: config.networkMutation ? null : "not_enabled",
        },
      };
    }
    if (typeof config.networkUnavailable === "boolean") {
      fixture.networkUnavailable = config.networkUnavailable;
    }
    if (typeof config.cameraConnected === "boolean") {
      fixture.cameraConnected = config.cameraConnected;
      const camera = {
        schema: "ylx.camera-connection.v1",
        state: config.cameraConnected ? "connected" : "disconnected",
      };
      fixture.device.runtime = {
        ...fixture.device.runtime,
        camera,
        camera_focus: config.cameraConnected ? makeCameraFocusStatus() : null,
      };
      fixture.snapshot = {
        ...fixture.snapshot,
        source_revision: fixture.snapshot.source_revision + 1,
        snapshot: {
          ...fixture.snapshot.snapshot,
          runtime: {
            ...fixture.snapshot.snapshot.runtime,
            camera,
            camera_focus: config.cameraConnected ? makeCameraFocusStatus() : null,
          },
        },
      };
    }
    if (typeof config.sessionsVolumeUnavailable === "boolean") {
      fixture.sessionsVolumeUnavailable = config.sessionsVolumeUnavailable;
      if (config.sessionsVolumeUnavailable) {
        fixture.device.capabilities.capture = false;
        fixture.device.storage = {
          volume_id: null,
          total_bytes: 0,
          available_bytes: 0,
          writable: false,
        };
      }
    }
    if (Number.isFinite(config.sessionsDelayMs)) {
      fixture.sessionsDelayMs = Number(config.sessionsDelayMs);
    }
    if (Number.isFinite(config.sessionPublicationDelayMs)) {
      fixture.sessionPublicationDelayMs = Number(config.sessionPublicationDelayMs);
    }
    if (Number.isFinite(config.eventSnapshotDelayMs)) {
      fixture.eventSnapshotDelayMs = Number(config.eventSnapshotDelayMs);
    }
    if (typeof config.cameraFocusAutoSupported === "boolean") {
      setCameraFocusAutoSupported(config.cameraFocusAutoSupported);
    }
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/state" && request.method === "POST") {
    const body = /** @type {{deviceState?: string, displayName?: string, broadcast?: boolean}} */ (
      await readJson(request)
    );
    if (body.deviceState === "recording") {
      setRecording(body.displayName ?? "其他客户端录制");
    }
    if (body.broadcast) {
      broadcastSnapshot();
    }
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/state-event" && request.method === "POST") {
    const body = /** @type {{displayName?: string, valid?: boolean}} */ (await readJson(request));
    broadcastStateEvent(body.valid !== false, body.displayName ?? "其他客户端录制");
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/terminal-state-event" && request.method === "POST") {
    broadcastTerminalStateEvent();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/disconnect-events" && request.method === "POST") {
    for (const eventResponse of eventResponses) {
      eventResponse.end();
    }
    eventResponses.clear();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/network-snapshot" && request.method === "POST") {
    const body = /** @type {{defaultRoute?: string, wifiState?: string, wifiSsid?: string, wifiAddress?: string, wiredState?: string, wiredAddress?: string}} */ (
      await readJson(request)
    );
    const current = fixture.device.runtime.network;
    const defaultRoute =
      body.defaultRoute === "wifi_client" || body.defaultRoute === "wired" || body.defaultRoute === "none"
        ? body.defaultRoute
        : current.default_route;
    const nextNetwork = {
      ...current,
      wifi_client: {
        ...current.wifi_client,
        state: typeof body.wifiState === "string" ? body.wifiState : current.wifi_client.state,
        interface:
          typeof body.wifiState === "string" && body.wifiState !== "disabled"
            ? "wlan0"
            : current.wifi_client.interface,
        addresses:
          typeof body.wifiAddress === "string" ? [body.wifiAddress] : current.wifi_client.addresses,
        peer_or_ssid:
          typeof body.wifiSsid === "string" ? body.wifiSsid : current.wifi_client.peer_or_ssid,
      },
      wired: {
        ...current.wired,
        state: typeof body.wiredState === "string" ? body.wiredState : current.wired.state,
        addresses:
          typeof body.wiredAddress === "string" ? [body.wiredAddress] : current.wired.addresses,
      },
      default_route: defaultRoute,
    };
    setNetworkRuntime(
      nextNetwork,
      defaultRoute === "wifi_client"
        ? "wifi_client"
        : defaultRoute === "wired"
          ? "ethernet_lan"
          : "wifi_ap",
    );
    broadcastNetworkSnapshot();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/network-transaction-event" && request.method === "POST") {
    const body = /** @type {{status?: string, stage?: string, operation?: string}} */ (
      await readJson(request)
    );
    const status = body.status ?? "rescued";
    const sourceRevision = fixture.networkStatus.source_revision + 1;
    const active = fixture.networkStatus.transaction.current;
    const transaction = makeNetworkTransaction({
      ...(active ?? {}),
      authority_epoch: fixture.networkStatus.authority_epoch,
      source_revision: sourceRevision,
      status,
      stage:
        body.stage ??
        (status === "rescued" ? "rescued" : status === "committed" ? "committed" : "failed"),
      operation: body.operation ?? active?.operation ?? "apply",
      deadline: null,
      recovery_action:
        status === "rescued"
          ? "reconnect_rescue_ap"
          : status === "committed"
            ? "reconnect_target_lan"
            : "retry",
      error:
        status === "rescued" || status === "failed"
          ? {
              code: "dhcp_timeout",
              message: "candidate Wi-Fi failed before commit",
              retryable: true,
            }
          : null,
    });
    fixture.networkStatus = {
      ...fixture.networkStatus,
      source_revision: sourceRevision,
      observed_at: transaction.updated_at,
      desired:
        status === "committed"
          ? structuredClone(transaction.desired)
          : fixture.networkStatus.desired,
      saved:
        status === "committed"
          ? transaction.desired.mode === "wifi-client"
          : fixture.networkStatus.saved,
      verified:
        status === "committed"
          ? transaction.desired.mode === "wifi-client"
          : fixture.networkStatus.verified,
      transaction: {
        current: null,
        latest: transaction,
      },
    };
    broadcastNetworkTransaction(transaction);
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/safe-swap" && request.method === "POST") {
    completeSafeSwap();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/unsafe-safe-swap" && request.method === "POST") {
    const body = /** @type {{state?: "mounted" | "open-handles"}} */ (await readJson(request));
    broadcastUnsafeSafeSwap(body.state ?? "mounted");
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/safe-swap-gap" && request.method === "POST") {
    completeSafeSwapWithGap();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/new-authority-recording" && request.method === "POST") {
    startNewAuthorityRecording();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/stale-safe-swap" && request.method === "POST") {
    if (fixture.staleSafeSwapEvent) {
      broadcastEvent(fixture.staleSafeSwapEvent);
    }
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/related-resources" && request.method === "POST") {
    mutateRelatedResources();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/related-resources-silent" && request.method === "POST") {
    mutateRelatedResources(false);
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/diagnostic" && request.method === "POST") {
    const diagnostic = canonicalDiagnosticEvent.data.diagnostic;
    broadcastEvent(
      captureEvent(
        "diagnostic",
        { schema: "ylx.capture-diagnostic-event.v2", diagnostic },
        sessionId,
      ),
    );
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/fail-capture" && request.method === "POST") {
    setFailed();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/interrupted-capture" && request.method === "POST") {
    setInterrupted();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/progress" && request.method === "POST") {
    advanceProgress();
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/__fixture/requests") {
    sendJson(response, 200, {
      requests: fixture.apiRequests,
      preview: {
        requests: fixture.previewRequests,
        concurrent: fixture.previewActive.size,
        maxConcurrent: fixture.previewMaxConcurrent,
        timeline: fixture.previewTimeline,
      },
    });
    return;
  }

  /** @type {{path: string, authorization: string | null, lastEventId: string | null, idempotencyKey: string | null, body?: unknown} | null} */
  let apiRequest = null;
  if (url.pathname.startsWith("/api/")) {
    apiRequest = {
      path: url.pathname,
      authorization: request.headers.authorization ?? null,
      lastEventId:
        typeof request.headers["last-event-id"] === "string"
          ? request.headers["last-event-id"]
          : null,
      idempotencyKey:
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : null,
    };
    fixture.apiRequests.push(apiRequest);
    if (!url.pathname.startsWith("/api/v4/")) {
      sendJson(response, 410, {
        schema: "ylx.api-error.v2",
        error: {
          code: "unsupported_device_api_major",
          message: "fixture only serves Device API v4",
          request_id: "f6456e6c-3a8a-4edb-9b5d-793d561d8662",
          retryable: false,
          details: { path: url.pathname },
        },
      });
      return;
    }
    if (rejectMissingBearer(request, response)) {
      return;
    }
  }

  if (url.pathname === "/api/v4/device") {
    sendJson(response, 200, fixture.device);
    return;
  }

  if (url.pathname === "/api/v4/capture/status") {
    sendJson(response, 200, fixture.snapshot);
    return;
  }

  if (url.pathname === "/api/v4/camera/focus") {
    const current = currentCameraFocus();
    if (!current) {
      sendJson(response, 404, {
        schema: "ylx.api-error.v2",
        error: {
          code: "camera_focus_unsupported",
          message: "当前相机没有可读取的焦距控制",
          request_id: "ff5dd970-a6db-4872-91da-f28c0cd12b70",
          retryable: false,
        },
      });
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, current);
      return;
    }
    if (request.method === "POST") {
      const body = /** @type {{schema?: string, value?: unknown, auto_enabled?: unknown}} */ (
        await readJson(request)
      );
      if (apiRequest) {
        apiRequest.body = redactSecrets(body);
      }
      const hasValue = Object.hasOwn(body, "value");
      const hasAuto = Object.hasOwn(body, "auto_enabled");
      if (
        !request.headers["idempotency-key"] ||
        body.schema !== "ylx.camera-focus-set.v1" ||
        (!hasValue && !hasAuto) ||
        (hasValue && (typeof body.value !== "number" || !Number.isInteger(body.value))) ||
        (hasAuto && typeof body.auto_enabled !== "boolean")
      ) {
        sendJson(response, 400, {
          schema: "ylx.api-error.v2",
          error: {
            code: "invalid_camera_focus",
            message: "焦距请求不符合 v4 契约",
            request_id: "f347fe47-1556-4c1c-b855-90f3fa9733bd",
            retryable: false,
          },
        });
        return;
      }
      const next = setCameraFocus(body);
      sendJson(response, 200, next);
      broadcastSnapshot();
      return;
    }
  }

  if (url.pathname === "/api/v4/network/scan" && request.method === "GET") {
    if (fixture.networkUnavailable) {
      networkProblem(response, 503, "network_manager_unavailable", "Wi-Fi 扫描暂不可用");
      return;
    }
    sendJson(response, 200, makeNetworkScan());
    return;
  }

  if (url.pathname === "/api/v4/network/credentials" && request.method === "POST") {
    if (!fixture.networkStatus.mutation_capability.enabled) {
      await failClosedNetworkMutation(request, response, apiRequest);
      return;
    }
    const body = await readJson(request);
    if (apiRequest) {
      apiRequest.body = redactSecrets(body);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join("|") !== "passphrase|schema" ||
      body.schema !== "ylx.network-credential-request.v1" ||
      typeof body.passphrase !== "string" ||
      Buffer.byteLength(body.passphrase) < 8 ||
      Buffer.byteLength(body.passphrase) > 63
    ) {
      networkProblem(response, 400, "invalid_request", "Wi-Fi 密码不符合 v4 契约");
      return;
    }
    const credentialRef = `cred-fixture-${fixture.nextNetworkCredential++}`;
    fixture.networkCredentialRefs.add(credentialRef);
    sendJson(response, 201, {
      schema: "ylx.network-credential-receipt.v1",
      credential_ref: credentialRef,
      issued_at: "2026-08-23T10:30:00Z",
      expires_at: "2026-08-23T10:31:00Z",
      ttl_seconds: 60,
      single_use: true,
    });
    return;
  }

  if (url.pathname === "/api/v4/network/events" && request.method === "GET") {
    if (fixture.networkUnavailable) {
      sendJson(response, 404, {
        schema: "ylx.api-error.v2",
        error: {
          code: "network_unavailable",
          message: "当前设备未开放网络配置接口",
          request_id: "c8f29e94-3ba4-4d91-a2ac-df67aa9b4a77",
          retryable: false,
        },
      });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    networkEventResponses.add(response);
    writeNetworkEvent(response, networkEvent("snapshot"));
    request.on("close", () => networkEventResponses.delete(response));
    return;
  }

  if (url.pathname === "/api/v4/network") {
    if (fixture.networkUnavailable) {
      sendJson(response, 404, {
        schema: "ylx.api-error.v2",
        error: {
          code: "network_unavailable",
          message: "当前设备未开放网络配置接口",
          request_id: "c8f29e94-3ba4-4d91-a2ac-df67aa9b4a77",
          retryable: false,
        },
      });
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, fixture.networkStatus);
      return;
    }
    await failClosedNetworkMutation(request, response, apiRequest);
    return;
  }

  if (
    request.method === "POST" &&
    ["/api/v4/network/apply", "/api/v4/network/retry", "/api/v4/network/forget"].includes(
      url.pathname,
    )
  ) {
    if (!fixture.networkStatus.mutation_capability.enabled) {
      await failClosedNetworkMutation(request, response, apiRequest);
      return;
    }
    const body = await readJson(request);
    if (apiRequest) {
      apiRequest.body = redactSecrets(body);
    }
    if (!request.headers["idempotency-key"] || !body || typeof body !== "object") {
      networkProblem(response, 400, "invalid_request", "网络命令缺少幂等键或请求正文");
      return;
    }

    let receipt;
    if (url.pathname.endsWith("/apply")) {
      const desired = body.desired;
      if (
        body.schema === "ylx.network-apply-request.v1" &&
        desired?.mode === "hotspot" &&
        desired?.wifi_client === null &&
        desired?.ethernet === null
      ) {
        receipt = acceptFixtureNetworkTransaction("apply", {
          mode: "hotspot",
          wifi_client: null,
          ethernet: null,
        });
      } else {
        const wifi = desired?.wifi_client;
        const security = wifi?.security;
        const credentialRef = wifi?.credential_ref;
        const protectedNetwork = security !== "open";
        const validCredential =
          typeof credentialRef === "string" && fixture.networkCredentialRefs.has(credentialRef);
        if (
          body.schema !== "ylx.network-apply-request.v1" ||
          desired?.mode !== "wifi-client" ||
          desired?.ethernet !== null ||
          typeof wifi?.ssid !== "string" ||
          !["open", "wpa2-personal", "wpa3-personal", "wpa2-wpa3-personal"].includes(security) ||
          (protectedNetwork && !validCredential) ||
          (!protectedNetwork && credentialRef !== undefined)
        ) {
          networkProblem(
            response,
            422,
            "invalid_network_desired_state",
            "网络目标状态不符合 v4 契约",
          );
          return;
        }
        if (validCredential) {
          fixture.networkCredentialRefs.delete(credentialRef);
        }
        receipt = acceptFixtureNetworkTransaction("apply", {
          mode: "wifi-client",
          wifi_client: {
            ssid: wifi.ssid,
            security,
            credential_state: protectedNetwork ? "stored" : "absent",
          },
          ethernet: null,
        });
      }
    } else if (url.pathname.endsWith("/retry")) {
      const retained =
        fixture.networkStatus.transaction.latest ?? fixture.networkStatus.transaction.current;
      if (
        body.schema !== "ylx.network-retry-request.v1" ||
        typeof body.transaction_id !== "string" ||
        retained?.transaction_id !== body.transaction_id
      ) {
        networkProblem(response, 404, "network_transaction_not_found", "没有可重试的网络事务");
        return;
      }
      receipt = acceptFixtureNetworkTransaction("retry", retained.desired);
    } else {
      if (body.schema !== "ylx.network-forget-request.v1" || Object.keys(body).length !== 1) {
        networkProblem(response, 400, "invalid_request", "忘记网络请求不符合 v4 契约");
        return;
      }
      receipt = acceptFixtureNetworkTransaction("forget", {
        mode: "hotspot",
        wifi_client: null,
        ethernet: null,
      });
      fixture.networkStatus.saved = false;
      fixture.networkStatus.verified = false;
    }
    sendJson(response, 202, receipt);
    broadcastNetworkTransaction(receipt.transaction);
    return;
  }

  if (url.pathname === "/api/v4/preview") {
    fixture.previewRequests += 1;
    const requestId = fixture.previewRequests;
    fixture.previewActive.add(requestId);
    fixture.previewTimeline.push({
      requestId,
      phase: "start",
      at: performance.now(),
      method: request.method,
      accept: request.headers.accept ?? null,
      destination: request.headers["sec-fetch-dest"] ?? null,
      referer: request.headers.referer ?? null,
    });
    fixture.previewMaxConcurrent = Math.max(
      fixture.previewMaxConcurrent,
      fixture.previewActive.size,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, fixture.previewDelayMs));
    if (!fixture.cameraConnected) {
      fixture.previewActive.delete(requestId);
      fixture.previewTimeline.push({ requestId, phase: "end", at: performance.now() });
      const payload = JSON.stringify({
        schema: "ylx.api-error.v2",
        error: {
          code: "camera_not_connected",
          message: "相机未接入",
          request_id: "52c5780a-bbc4-4cd0-992c-1c7621b636aa",
          retryable: true,
        },
      });
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(payload),
        "Content-Type": "application/problem+json",
        "YLX-Error-Code": "camera_not_connected",
      });
      response.end(payload);
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": previewJpeg.length,
      "Content-Type": "image/jpeg",
      "X-YLX-Preview-Sequence": String(requestId),
    });
    response.end(previewJpeg);
    fixture.previewActive.delete(requestId);
    fixture.previewTimeline.push({ requestId, phase: "end", at: performance.now() });
    return;
  }

  if (url.pathname === "/api/v4/capture/start" && request.method === "POST") {
    const body = /** @type {{schema?: string, mode?: string, take?: {kind?: string}, display_name?: string}} */ (
      await readJson(request)
    );
    if (!fixture.cameraConnected) {
      sendJson(response, 503, {
        schema: "ylx.api-error.v2",
        error: {
          code: "camera_not_connected",
          message: "相机未接入",
          request_id: "da0d92b1-8c15-4cf9-ad70-81aa1d40e7c1",
          retryable: true,
        },
      });
      return;
    }
    if (
      !request.headers["idempotency-key"] ||
      body.schema !== "ylx.capture-start.v2" ||
      body.mode !== "production" ||
      body.take?.kind !== "new"
    ) {
      sendJson(response, 400, {
        schema: "ylx.api-error.v2",
        error: {
          code: "invalid_capture_start",
          message: "录制请求不符合 v4 契约",
          request_id: "f91cd40f-5715-46be-8fa8-cc67b58d1572",
          retryable: false,
        },
      });
      return;
    }
    if (fixture.startProblem) {
      sendJson(response, 409, canonicalCaptureBusyProblem);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, fixture.commandDelayMs));
    setRecording(body.display_name ?? "未命名录制");
    sendJson(response, 202, fixture.snapshot);
    broadcastSnapshot();
    return;
  }

  if (url.pathname === "/api/v4/capture/stop" && request.method === "POST") {
    const body = /** @type {{schema?: string, reason?: string}} */ (await readJson(request));
    if (
      !request.headers["idempotency-key"] ||
      body.schema !== "ylx.capture-stop.v2" ||
      !["user", "safe_swap"].includes(body.reason ?? "")
    ) {
      sendJson(response, 400, {
        schema: "ylx.api-error.v2",
        error: {
          code: "invalid_capture_stop",
          message: "结束请求不符合 v4 契约",
          request_id: "024d4a33-8d89-43f8-87e6-413fc0c8aaef",
          retryable: false,
        },
      });
      return;
    }
    if (fixture.stopProblem) {
      sendJson(response, 503, {
        schema: "ylx.api-error.v2",
        error: {
          code: "storage_finalize_failed",
          message: "存储封存暂时失败，请重试",
          request_id: "024d4a33-8d89-43f8-87e6-413fc0c8aaef",
          retryable: true,
          details: { volume_id: volumeId },
        },
      });
      return;
    }
    if (!fixture.snapshot.snapshot.active_recording) {
      response.writeHead(204).end();
      return;
    }
    if (fixture.stopReturns204) {
      setIdleAfterUserStop();
      response.writeHead(204).end();
      return;
    }
    setFinalizing();
    sendJson(response, 202, fixture.snapshot);
    broadcastSnapshot();
    if (body.reason === "user") {
      setTimeout(() => {
        setIdleAfterUserStop();
        broadcastSnapshot();
      }, 80);
    }
    return;
  }

  if (url.pathname === "/api/v4/sessions") {
    const sessionsSnapshot = structuredClone(fixture.sessions);
    if (fixture.sessionsDelayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, fixture.sessionsDelayMs));
    }
    if (fixture.sessionsVolumeUnavailable) {
      sendJson(response, 409, {
        schema: "ylx.api-error.v2",
        error: {
          code: "volume_not_mounted",
          message: "录制卷不是当前活动挂载点",
          request_id: "962f25f5-c8f1-42cb-a598-4143a806d89f",
          retryable: true,
          details: {},
        },
      });
      return;
    }
    sendJson(response, 200, sessionsSnapshot);
    return;
  }

  if (url.pathname === "/api/v4/capture/safe-swap") {
    if (fixture.safeSwapResource) {
      sendJson(response, 200, fixture.safeSwapResource);
      return;
    }
    sendJson(response, 404, {
      schema: "ylx.api-error.v2",
      error: {
        code: "safe_swap_receipt_not_found",
        message: "当前没有安全换盘回执",
        request_id: "dd268911-b58f-46ef-8670-ae98239c2a33",
        retryable: false,
      },
    });
    return;
  }

  if (url.pathname === "/api/v4/capture/events") {
    if (fixture.eventsUnavailable) {
      sendJson(response, 503, {
        schema: "ylx.api-error.v2",
        error: {
          code: "event_stream_unavailable",
          message: "设备事件流暂不可用",
          request_id: "0c0e7364-787c-4a97-b7ef-79674089d6c2",
          retryable: true,
          details: {},
        },
      });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    eventResponses.add(response);
    if (fixture.eventSnapshotDelayMs > 0) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, fixture.eventSnapshotDelayMs),
      );
    }
    writeEvent(response, captureEvent("snapshot", fixture.snapshot.snapshot));
    request.on("close", () => eventResponses.delete(response));
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = resolve(webRoot, requested);
  if (!filePath.startsWith(`${webRoot}${sep}`)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(4173, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
