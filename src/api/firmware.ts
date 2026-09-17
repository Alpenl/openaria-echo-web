import { idempotencyKey, makeApiError, requestHeaders, DeviceApiError } from "./client";

export type FirmwareRelease = { version: string; commit: string };
export type FirmwareTask = {
  id: string;
  action: "update" | "rollback";
  target_commit: string;
  status: "accepted" | "running" | "succeeded" | "failed";
  message: string;
  started_at: number;
  finished_at: number | null;
};
export type FirmwareStatus = {
  schema: "openaria.firmware-status.v1";
  supported: boolean;
  current: FirmwareRelease | null;
  previous: FirmwareRelease | null;
  available: (FirmwareRelease & { release_notes: string; published_at: string | null }) | null;
  has_update: boolean;
  checked_at: number | null;
  warning: string | null;
  task: FirmwareTask | null;
};

function release(value: unknown): value is FirmwareRelease {
  if (!value || typeof value !== "object") return false;
  const entry = value as FirmwareRelease;
  return typeof entry.version === "string" && /^\d+\.\d+\.\d+$/.test(entry.version) &&
    typeof entry.commit === "string" && /^[0-9a-f]{40}$/.test(entry.commit);
}

function task(value: unknown): value is FirmwareTask {
  if (!value || typeof value !== "object") return false;
  const entry = value as FirmwareTask;
  return typeof entry.id === "string" && /^[0-9a-f-]{36}$/.test(entry.id) &&
    (entry.action === "update" || entry.action === "rollback") &&
    typeof entry.target_commit === "string" && /^[0-9a-f]{40}$/.test(entry.target_commit) &&
    ["accepted", "running", "succeeded", "failed"].includes(entry.status) &&
    typeof entry.message === "string" && Number.isFinite(entry.started_at) &&
    (entry.finished_at === null || Number.isFinite(entry.finished_at));
}

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 80000);
  try {
    const response = await fetch(`/api/v4/firmware${path}`, {
      ...options, cache: "no-store",
      headers: requestHeaders("application/json", options.headers, options.method === "POST"),
      signal: controller.signal,
    });
    if (!response.ok) throw await makeApiError(response);
    return await response.json();
  } finally { window.clearTimeout(timeout); }
}

export async function getFirmware(check = false, force = false): Promise<FirmwareStatus> {
  const value = await request(check ? `/check?force=${force}` : "") as FirmwareStatus;
  if (!value || value.schema !== "openaria.firmware-status.v1" ||
      typeof value.supported !== "boolean" || typeof value.has_update !== "boolean" ||
      !(value.current === null || release(value.current)) ||
      !(value.previous === null || release(value.previous)) ||
      !(value.available === null || (release(value.available) && typeof value.available.release_notes === "string")) ||
      !(value.task === null || task(value.task)) ||
      !(value.warning === null || typeof value.warning === "string") ||
      !(value.checked_at === null || Number.isFinite(value.checked_at))) {
    throw new DeviceApiError("设备更新状态无效", 502, "invalid_firmware_status");
  }
  return value;
}

export async function startFirmware(action: "update" | "rollback", commit: string, key = idempotencyKey()): Promise<FirmwareTask> {
  const value = await request(`/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ commit }),
  });
  if (!task(value)) throw new DeviceApiError("设备更新任务无效", 502, "invalid_firmware_task");
  return value;
}
