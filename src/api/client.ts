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
      sha256: "75f380e09a17972f65b6e64848be9754e7b730f88aa53bd7f3899f4b24e4da63",
      bytes: 115169,
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

export function requestHeaders(accept: string, initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("Accept", accept);
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    cache: "no-store",
    headers: requestHeaders("application/json", options.headers),
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

export const deviceApi = Object.freeze({
  getDevice: () => requestJson<DeviceDescriptor>("/device").then(assertSupportedDevice),
  getCaptureStatus: () => requestJson<CaptureStatus>("/capture/status").then(assertCaptureStatus),
  getSafeSwap: () =>
    requestOptionalJson<{ schema: string; receipt: unknown }>("/capture/safe-swap"),
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
    return requestJson<SessionList>(`/sessions?${query.toString()}`);
  },
  getSession: (sessionId: string) =>
    requestJson<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`),
  /** 只读结果接口：查询未成功会话不隐含 recovery，也不改变任何设备状态。 */
  getUnsuccessfulOutcome: (sessionId: string) =>
    requestOptionalJson<UnsuccessfulOutcome>(
      `/sessions/${encodeURIComponent(sessionId)}/unsuccessful-outcome`,
    ),
  /** 不可变快照的 Range 地址：按 artifact_id 寻址，不从 path 或 object key 猜角色。 */
  artifactUrl: (sessionId: string, artifactId: string) =>
    `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,

  startCapture: (displayName: string, mode: "production" | "calibration" = "production") =>
    requestJson<CaptureStatus>(
      "/capture/start",
      commandInit({
        schema: "ylx.capture-start.v2",
        mode,
        display_name: displayName,
        take: { kind: "new" },
      }),
    ).then(assertCaptureStatus),
  stopCapture: (reason: "user" | "safe_swap") =>
    requestJson<CaptureStatus>(
      "/capture/stop",
      commandInit({ schema: "ylx.capture-stop.v2", reason }),
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
