const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return "--";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "--";
  }
  return `${seconds.toFixed(1)} 秒`;
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return value.toLocaleString("en-US");
}

export function formatCelsius(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} °C` : "--";
}

/** IMU 是 raw int16，不做单位换算：换算属于标定工具链，不属于控制面。 */
export function formatVector(
  vector: { x: number; y: number; z: number } | null | undefined,
): string {
  if (!vector) {
    return "不可用";
  }
  return [vector.x, vector.y, vector.z]
    .map((component) => String(component).padStart(7, " "))
    .join(" ");
}

export function formatStepProgress(
  progress: { completed: number; total: number } | undefined,
): string {
  if (!progress || typeof progress.total !== "number" || progress.total <= 0) {
    return "--";
  }
  const percent = Math.min(100, Math.round((progress.completed / progress.total) * 100));
  return `${percent}% · ${progress.completed}/${progress.total}`;
}

export function formatClock(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function formatTimeOfDay(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString("zh-CN", { hour12: false });
}

const DEVICE_STATE_LABELS: Record<string, string> = {
  idle: "待机",
  recording: "录制中",
  finalizing: "封存中",
  encoding: "编码中",
  verifying: "校验中",
  blocked: "受阻",
};

export function deviceStateLabel(state: string | null | undefined): string {
  if (!state) {
    return "未连接";
  }
  return DEVICE_STATE_LABELS[state] ?? state;
}

const CONNECTION_LABELS: Record<string, string> = {
  wifi_client: "Wi-Fi 客户端",
  wifi_ap: "热点",
  hotspot: "热点",
  wired: "有线",
  ethernet: "有线",
  unknown: "未知",
};

export function connectionMethodLabel(method: string | null | undefined): string {
  if (!method) {
    return "--";
  }
  return CONNECTION_LABELS[method] ?? method;
}

const INTERFACE_STATE_LABELS: Record<string, string> = {
  connected: "已连接",
  disconnected: "未连接",
  disabled: "未启用",
  activating: "连接中",
  unavailable: "不可用",
};

export function interfaceStatus(
  status: { state: string; addresses: string[]; peer_or_ssid: string | null } | null | undefined,
): string {
  if (!status) {
    return "不可用";
  }
  const label = INTERFACE_STATE_LABELS[status.state] ?? status.state;
  const parts = [label];
  if (status.peer_or_ssid) {
    parts.push(status.peer_or_ssid);
  }
  if (status.addresses.length > 0) {
    parts.push(status.addresses.join(" "));
  }
  return parts.join(" / ");
}

const IMU_SYNC_LABELS: Record<string, string> = {
  good: "good",
  degraded: "degraded",
  insufficient: "insufficient",
};

export function imuSyncLabel(quality: string | null | undefined): string {
  if (!quality) {
    return "不可用";
  }
  return IMU_SYNC_LABELS[quality] ?? quality;
}
