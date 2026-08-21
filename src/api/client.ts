import type {
  CameraFocusStatus,
  CaptureStatus,
  DeviceDescriptor,
  NetworkStatus,
  SessionDetail,
  SessionList,
  UnsuccessfulOutcome,
} from "./types";

const API_ROOT = "/api/v3";
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
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey(),
    },
    body: JSON.stringify(body),
  };
}

export interface ListSessionsQuery {
  limit?: number;
  cursor?: string | null;
}

export const deviceApi = {
  getDevice: () => requestJson<DeviceDescriptor>("/device"),
  getCaptureStatus: () => requestJson<CaptureStatus>("/capture/status"),
  getSafeSwap: () =>
    requestOptionalJson<{ schema: string; receipt: unknown }>("/capture/safe-swap"),
  getCameraFocus: () => requestOptionalJson<CameraFocusStatus>("/camera/focus"),
  getNetwork: () => requestOptionalJson<NetworkStatus>("/network"),

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
    ),
  stopCapture: (reason: "user" | "safe_swap") =>
    requestJson<CaptureStatus>(
      "/capture/stop",
      commandInit({ schema: "ylx.capture-stop.v2", reason }),
    ),
  setCameraFocus: (request: { value?: number; auto_enabled?: boolean }) =>
    requestJson<CameraFocusStatus>(
      "/camera/focus",
      commandInit({ schema: "ylx.camera-focus-set.v1", ...request }),
    ),
  setNetwork: (request: Record<string, unknown>) =>
    requestJson<unknown>("/network", commandInit({ schema: "ylx.network-apply.v1", ...request })),
};

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
