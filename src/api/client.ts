import type {
  CameraFocusStatus,
  CaptureStatus,
  DeviceDescriptor,
  NetworkApplyDesiredState,
  NetworkCredentialReceipt,
  NetworkScanResult,
  NetworkStatus,
  NetworkTransactionReceipt,
  SessionDetail,
  SessionDeleteItem,
  SessionDeleteResult,
  SessionList,
  UnsuccessfulOutcome,
} from "./types";
import {
  isNetworkApplyDesiredState,
  isNetworkCredentialReceipt,
  isNetworkScanResult,
  isNetworkStatus,
  isNetworkTransactionReceipt,
} from "./network";
import { isSessionList } from "./sessions";

export const API_ROOT = "/api/v4";
export const DEVICE_API_CONSUMER_SUPPORT = {
  schema: "ylx.device-api-consumer-support.v1",
  consumer: "openaria-echo-web",
  supported_device_api_majors: [4],
  unknown_major_policy: "fail_closed",
  required_contracts: [
    {
      major: 4,
      path: "openapi/ylx-device-v4.openapi.yaml",
      sha256: "00e71f5fc5dec89d0fba93af9bea447d92ffc79a90a2735ab8dff5214a561d65",
      bytes: 132425,
      info_version: "4.0.0",
      server_base_path: API_ROOT,
      lifecycle: "current",
    },
  ],
} as const;
const TOKEN_KEY = "rp-ylx-access-token";

export class DeviceApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code = `http_${status}`,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DeviceApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function deviceApiMajor(apiVersion: unknown): number | null {
  if (typeof apiVersion !== "string") {
    return null;
  }
  const match = apiVersion.match(/^(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

const CAPABILITY_KEYS = new Set([
  "capture",
  "preview",
  "range_download",
  "network_mutation",
  "session_list",
  "session_detail",
  "artifact_download",
  "capture_status",
  "session_deletion",
  "calibration_capture",
]);
const CALIBRATION_CAPABILITY_KEYS = new Set([
  "supported",
  "enabled",
  "disabled_reason",
  "required_video_layout",
]);
const CALIBRATION_DISABLED_REASONS = new Set([
  "capture_source_unsupported",
  "storage_unavailable",
  "hardware_unavailable",
  "maintenance_or_capture_busy",
]);

function hasExactKeys(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function assertSupportedCapabilities(device: DeviceDescriptor): void {
  const capabilities: unknown = device.capabilities;
  const calibration = hasExactKeys(capabilities, CAPABILITY_KEYS)
    ? capabilities.calibration_capture
    : null;
  const closedCalibration = hasExactKeys(calibration, CALIBRATION_CAPABILITY_KEYS);
  const booleansValid =
    hasExactKeys(capabilities, CAPABILITY_KEYS) &&
    typeof capabilities.capture === "boolean" &&
    typeof capabilities.preview === "boolean" &&
    capabilities.range_download === true &&
    typeof capabilities.network_mutation === "boolean" &&
    capabilities.session_list === true &&
    capabilities.session_detail === true &&
    capabilities.artifact_download === true &&
    capabilities.capture_status === true &&
    typeof capabilities.session_deletion === "boolean";
  const calibrationValid =
    closedCalibration &&
    typeof calibration.supported === "boolean" &&
    typeof calibration.enabled === "boolean" &&
    calibration.required_video_layout === "split-eyes" &&
    (calibration.enabled === true
      ? calibration.supported === true && calibration.disabled_reason === null
      : typeof calibration.disabled_reason === "string" &&
        CALIBRATION_DISABLED_REASONS.has(calibration.disabled_reason));
  if (!booleansValid || !calibrationValid) {
    throw new DeviceApiError(
      "Device API capabilities 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
      { field: "capabilities" },
    );
  }
}

function assertSupportedDevice(device: DeviceDescriptor): DeviceDescriptor {
  const major = deviceApiMajor(device.api_version);
  if (
    major === null ||
    !(DEVICE_API_CONSUMER_SUPPORT.supported_device_api_majors as readonly number[]).includes(
      major,
    ) ||
    device.schema !== "ylx.device.v4"
  ) {
    throw new DeviceApiError("不支持的 Device API major", 426, "unsupported_device_api_major", {
      api_version: device.api_version ?? null,
      schema: device.schema ?? null,
      supported_device_api_majors: [...DEVICE_API_CONSUMER_SUPPORT.supported_device_api_majors],
    });
  }
  assertSupportedCapabilities(device);
  return device;
}

function assertCaptureStatus<T extends CaptureStatus | null>(capture: T): T {
  if (
    capture &&
    (capture.schema !== "ylx.capture-status.v4" ||
      capture.snapshot.schema !== "ylx.capture-snapshot-event.v4")
  ) {
    throw new DeviceApiError(
      "不支持的 Device API capture status schema",
      502,
      "unsupported_device_api_schema",
      {
        schema: capture.schema,
        snapshot_schema: capture.snapshot.schema,
      },
    );
  }
  return capture;
}

function assertNetworkStatus(network: unknown): NetworkStatus | null {
  if (network !== null && !isNetworkStatus(network)) {
    const envelope = network as { schema?: string; format?: string };
    throw new DeviceApiError(
      "Device API network status 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
      {
        schema: envelope.schema ?? null,
        format: envelope.format ?? null,
      },
    );
  }
  return network;
}

function assertNetworkScan(scan: unknown): NetworkScanResult {
  if (!isNetworkScanResult(scan)) {
    throw new DeviceApiError(
      "Device API network scan 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
    );
  }
  return scan;
}

function assertNetworkCredential(receipt: unknown): NetworkCredentialReceipt {
  if (!isNetworkCredentialReceipt(receipt)) {
    throw new DeviceApiError(
      "Device API network credential receipt 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
    );
  }
  return receipt;
}

function assertNetworkReceipt(receipt: unknown): NetworkTransactionReceipt {
  if (!isNetworkTransactionReceipt(receipt)) {
    throw new DeviceApiError(
      "Device API network transaction receipt 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
    );
  }
  return receipt;
}

function assertSessionList(sessions: unknown): SessionList {
  if (!isSessionList(sessions)) {
    const envelope = sessions as { schema?: unknown } | null;
    throw new DeviceApiError(
      "Device API session list 不符合冻结的 v2/v3 契约",
      502,
      "unsupported_device_api_schema",
      {
        schema: typeof envelope?.schema === "string" ? envelope.schema : null,
      },
    );
  }
  return sessions;
}

const SESSION_DELETE_RESULT_KEYS = new Set([
  "schema",
  "deleted_session_ids",
  "failed_sessions",
]);
const SESSION_DELETE_FAILURE_KEYS = new Set(["session_id", "error"]);

function assertSessionDeleteResult(result: unknown): SessionDeleteResult {
  const valid =
    hasExactKeys(result, SESSION_DELETE_RESULT_KEYS) &&
    result.schema === "ylx.session-delete-result.v1" &&
    Array.isArray(result.deleted_session_ids) &&
    new Set(result.deleted_session_ids).size === result.deleted_session_ids.length &&
    result.deleted_session_ids.every((sessionId) => typeof sessionId === "string") &&
    Array.isArray(result.failed_sessions) &&
    result.failed_sessions.every(
      (failure) =>
        hasExactKeys(failure, SESSION_DELETE_FAILURE_KEYS) &&
        typeof failure.session_id === "string" &&
        typeof failure.error === "string",
    );
  if (!valid) {
    throw new DeviceApiError(
      "Device API session deletion result 不符合 v4 契约",
      502,
      "unsupported_device_api_schema",
    );
  }
  return result as unknown as SessionDeleteResult;
}

export async function makeApiError(response: Response): Promise<DeviceApiError> {
  let problem: unknown = null;
  try {
    problem = await response.json();
  } catch {
    // 非 JSON 的失败仍然拿到稳定的本地错误码和消息。
  }
  const envelope = problem as { schema?: string; error?: Record<string, unknown> } | null;
  const error = envelope?.schema === "ylx.api-error.v2" ? envelope.error : null;
  return new DeviceApiError(
    typeof error?.message === "string" ? error.message : `设备接口返回 ${response.status}`,
    response.status,
    typeof error?.code === "string" ? error.code : `http_${response.status}`,
    error?.details && typeof error.details === "object"
      ? (error.details as Record<string, unknown>)
      : {},
  );
}

export function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timeout: number | null = null;
    const finish = () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      signal.removeEventListener("abort", finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    timeout = window.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** start/stop 用它做幂等键：重复请求返回同一事实，不多开 session。 */
export function idempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    const seed = `${Date.now()}-${Math.random()}-${performance.now()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (seed.charCodeAt(index % seed.length) ^ Math.floor(Math.random() * 256)) & 0xff;
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getAccessToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // 私密窗口里存不下 token 时仍然让本次会话继续。
  }
}

export function requestHeaders(
  accept: string,
  initial?: HeadersInit,
  includeCsrfToken = false,
): Headers {
  const headers = new Headers(initial);
  headers.set("Accept", accept);
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    if (includeCsrfToken) {
      headers.set("X-CSRF-Token", token);
    }
  }
  return headers;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    cache: "no-store",
    headers: requestHeaders("application/json", options.headers, method === "POST"),
  });
  if (!response.ok) {
    throw await makeApiError(response);
  }
  if (response.status === 204) {
    return null as T;
  }
  return (await response.json()) as T;
}

async function requestOptionalJson<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    cache: "no-store",
    headers: requestHeaders("application/json", options.headers),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await makeApiError(response);
  }
  return (await response.json()) as T;
}

function commandInit(body: unknown): RequestInit {
  return commandInitWithKey(body, idempotencyKey());
}

function commandInitWithKey(body: unknown, key: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  };
}

export interface ListSessionsQuery {
  limit?: number;
  cursor?: string | null;
}

type ClockStatus = {
  schema: "ylx.clock-status.v1";
  source: "ntp" | "client" | "unsynchronized";
  unix_time_ms: number;
  challenge: string | null;
  expires_in_ms: number;
  applied: boolean;
};

function assertClockStatus(value: unknown): ClockStatus {
  if (
    !hasExactKeys(value, new Set([
      "schema", "source", "unix_time_ms", "challenge", "expires_in_ms", "applied",
    ])) ||
    value.schema !== "ylx.clock-status.v1" ||
    !Number.isSafeInteger(value.unix_time_ms) || Number(value.unix_time_ms) < 0 ||
    typeof value.applied !== "boolean" ||
    (value.applied && value.source !== "client") ||
    !(value.source === "unsynchronized"
      ? typeof value.challenge === "string" && /^[0-9a-f]{32}$/.test(value.challenge) &&
        value.expires_in_ms === 5000
      : (value.source === "ntp" || value.source === "client") &&
        value.challenge === null && value.expires_in_ms === 0)
  ) {
    throw new DeviceApiError("设备校时响应无效", 502, "invalid_clock_status");
  }
  return value as ClockStatus;
}

let clockRequest: Promise<ClockStatus | null> | null = null;

async function synchronizeClock(): Promise<ClockStatus | null> {
  // Join connection/visibility/record-button attempts in this tab.
  if (clockRequest) return clockRequest;
  clockRequest = (async () => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 5000);
    try {
      const started = performance.now();
      const raw = await requestOptionalJson<unknown>("/clock", { signal: controller.signal });
      if (raw === null) return null; // Optional extension: older firmware keeps working.
      const status = assertClockStatus(raw);
      if (status.source !== "unsynchronized") return status;
      if (performance.now() - started > 2000) {
        throw new DeviceApiError("连接延迟较高，请重试校准日期", 409, "clock_challenge_expired");
      }
      const now = Date.now();
      if (now < 1704067200000 || now >= 4102444800000) {
        throw new DeviceApiError("请先校准这台手机或电脑的日期", 400, "client_clock_invalid");
      }
      const result = assertClockStatus(await requestJson<unknown>("/clock/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          schema: "ylx.clock-sync-request.v1",
          challenge: status.challenge,
          unix_time_ms: now,
        }),
      }));
      if (result.source === "unsynchronized") {
        throw new DeviceApiError("设备日期尚未校准，请重试", 503, "clock_sync_unavailable");
      }
      return result;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  })().finally(() => { clockRequest = null; });
  return clockRequest;
}

export const deviceApi = Object.freeze({
  syncClock: synchronizeClock,
  getDevice: (signal?: AbortSignal) => requestJson<DeviceDescriptor>("/device", { signal }).then(assertSupportedDevice),
  getCaptureStatus: (signal?: AbortSignal) => requestJson<CaptureStatus>("/capture/status", { signal }).then(assertCaptureStatus),
  getCameraFocus: () => requestOptionalJson<CameraFocusStatus>("/camera/focus"),
  getNetwork: () => requestOptionalJson<unknown>("/network").then(assertNetworkStatus),
  scanNetworks: () => requestJson<unknown>("/network/scan").then(assertNetworkScan),
  createNetworkCredential: (passphrase: string) =>
    requestJson<unknown>("/network/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "ylx.network-credential-request.v1", passphrase }),
    }).then(assertNetworkCredential),
  applyNetwork: (desired: NetworkApplyDesiredState, key = idempotencyKey()) => {
    if (!isNetworkApplyDesiredState(desired)) {
      return Promise.reject(
        new DeviceApiError(
          "网络目标状态不符合 v4 契约",
          400,
          "invalid_network_desired_state",
        ),
      );
    }
    return requestJson<unknown>(
      "/network/apply",
      commandInitWithKey({ schema: "ylx.network-apply-request.v1", desired }, key),
    ).then(assertNetworkReceipt);
  },
  retryNetwork: (transactionId: string, key = idempotencyKey()) =>
    requestJson<unknown>(
      "/network/retry",
      commandInitWithKey(
        { schema: "ylx.network-retry-request.v1", transaction_id: transactionId },
        key,
      ),
    ).then(assertNetworkReceipt),
  forgetNetwork: (key = idempotencyKey()) =>
    requestJson<unknown>(
      "/network/forget",
      commandInitWithKey({ schema: "ylx.network-forget-request.v1" }, key),
    ).then(assertNetworkReceipt),

  listSessions: ({ limit = 25, cursor = null }: ListSessionsQuery = {}) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      query.set("cursor", cursor);
    }
    return requestJson<unknown>(`/sessions?${query.toString()}`).then(assertSessionList);
  },
  getSession: async (sessionId: string) => {
    const response = await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
      headers: requestHeaders("application/json"),
    });
    if (!response.ok) throw await makeApiError(response);
    const detail = (await response.json()) as SessionDetail;
    if (detail.session_id !== sessionId) {
      throw new DeviceApiError("设备返回了不同录制的详情", 502, "invalid_session_identity");
    }
    // 新版列表仅含元数据。删除使用本次网关校验过的清单身份，不依赖列表的制品校验。
    const digest = response.headers.get("YLX-Manifest-SHA256");
    const etag = response.headers.get("ETag");
    const manifestSha256 = digest && /^[0-9a-f]{64}$/.test(digest) && etag === `"${digest}"`
      ? digest
      : null;
    return { detail, manifestSha256 };
  },
  deleteSessions: (
    sessions: readonly SessionDeleteItem[],
    key = idempotencyKey(),
  ) =>
    requestJson<unknown>(
      "/sessions/delete",
      commandInitWithKey({ schema: "ylx.session-delete-request.v1", sessions }, key),
    ).then(assertSessionDeleteResult),
  /** 只读结果接口：查询未成功会话不隐含 recovery，也不改变任何设备状态。 */
  getUnsuccessfulOutcome: (sessionId: string) =>
    requestOptionalJson<UnsuccessfulOutcome>(
      `/sessions/${encodeURIComponent(sessionId)}/unsuccessful-outcome`,
    ),
  /** 不可变快照的 Range 地址：按 artifact_id 寻址，不从 path 或 object key 猜角色。 */
  artifactUrl: (sessionId: string, artifactId: string) =>
    `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,

  startCapture: async (displayName?: string, mode: "production" | "calibration" = "production") => {
    // Date-derived session IDs and names must be allocated after calibration.
    await synchronizeClock();
    const normalizedDisplayName = displayName?.trim();
    return requestJson<CaptureStatus>(
      "/capture/start",
      commandInit({
        schema: "ylx.capture-start.v2",
        mode,
        ...(normalizedDisplayName ? { display_name: normalizedDisplayName } : {}),
        take: { kind: "new" },
      }),
    ).then(assertCaptureStatus);
  },
  stopCapture: () =>
    requestJson<CaptureStatus>(
      "/capture/stop",
      commandInit({ schema: "ylx.capture-stop.v2", reason: "user" }),
    ).then(assertCaptureStatus),
  setCameraFocus: (request: { value?: number; auto_enabled?: boolean }) =>
    requestJson<CameraFocusStatus>(
      "/camera/focus",
      commandInit({ schema: "ylx.camera-focus-set.v1", ...request }),
    ),
});

export async function getLatestPreview(signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`${API_ROOT}/preview`, {
    cache: "no-store",
    headers: requestHeaders("image/jpeg"),
    signal,
  });
  if (!response.ok) {
    throw await makeApiError(response);
  }
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0];
  if (contentType !== "image/jpeg") {
    throw new Error("设备预览不是 JPEG");
  }
  return response.blob();
}
