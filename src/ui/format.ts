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

/** 容量一律用 GiB 表达：设备卷是 GiB 量级，跨读数换单位会让人误判剩余空间。 */
export function formatGiB(bytes: number | null | undefined): string {
  return typeof bytes === "number" && Number.isFinite(bytes)
    ? `${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : "--";
}

/** 录制中的写入量用 MiB：GiB 在前几分钟里全是 0.0，读不出进展。 */
export function formatMiB(bytes: number | null | undefined): string {
  return typeof bytes === "number" && Number.isFinite(bytes)
    ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
    : "--";
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "--";
  }
  return `${seconds.toFixed(1)} 秒`;
}

export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "--";
}

/** IMU 是 raw int16，固定三位小数原样呈现，不做任何单位换算。 */
export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "--";
}

export function formatCelsius(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} °C` : "--";
}

export function formatVector(
  vector: { x: number; y: number; z: number } | null | undefined,
  unit: string,
): string {
  if (!vector || ![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    return "不可用";
  }
  return `x ${formatNumber(vector.x)}  y ${formatNumber(vector.y)}  z ${formatNumber(vector.z)} ${unit}`;
}

export function formatStepProgress(
  progress: { completed: number; total: number } | undefined,
): string {
  const completed = Number(progress?.completed);
  const total = Number(progress?.total);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return "--";
  }
  return `${completed}/${total}`;
}

export function releaseStateLabel(state: string | null | undefined): string {
  return state === "device-released" ? "设备已释放" : "已卸载";
}

export function verdictLabel(verdict: string | null | undefined): string {
  if (verdict === "usable") {
    return "可用";
  }
  if (verdict === "unusable") {
    return "不可用";
  }
  return "尚未校验";
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

/**
 * device_state 是设备此刻在做什么。它绝不承载历史终止结果：那由
 * retained_unsuccessful 单独投影到危险带，否则「上次失败」会掩盖「现在可以开始」。
 */
const DEVICE_STATE_LABELS: Record<string, string> = {
  blocked: "受阻",
  encoding: "编码中",
  finalizing: "正在结束",
  idle: "待机",
  recording: "录制中",
  verifying: "校验中",
};

/** 保留的未成功终止结果标签；只出现在危险带。 */
export const OUTCOME_LABELS: Record<string, string> = {
  abandoned: "已放弃",
  failed: "失败",
  media_lost: "介质丢失",
  recoverable: "可恢复失败",
};

export const CONNECTION_LABELS: Record<string, string> = {
  connected: "已连接",
  connecting: "正在连接",
  disconnected: "连接中断",
};

export const NETWORK_MODE_LABELS: Record<string, string> = {
  "ethernet-dhcp": "有线 DHCP",
  "ethernet-static": "有线静态",
  hotspot: "设备热点",
  "wifi-client": "Wi-Fi",
};

export const DEFAULT_ROUTE_LABELS: Record<string, string> = {
  none: "无默认路由",
  wifi_client: "Wi-Fi",
  wired: "有线",
};

export function defaultRouteLabel(route: string | null | undefined): string {
  return DEFAULT_ROUTE_LABELS[route ?? "none"] ?? "不可用";
}

export function deviceStateLabel(state: string | null | undefined): string {
  if (!state) {
    return "未连接";
  }
  return DEVICE_STATE_LABELS[state] ?? "状态未知";
}

const CONNECTION_METHOD_LABELS: Record<string, string> = {
  ethernet_direct: "直连网线",
  ethernet_lan: "局域网网线",
  offline: "离线",
  wifi_ap: "设备热点",
  wifi_client: "Wi-Fi",
};

export function connectionMethodLabel(method: string | null | undefined): string {
  if (!method) {
    return "--";
  }
  return CONNECTION_METHOD_LABELS[method] ?? method;
}

const INTERFACE_STATE_LABELS: Record<string, string> = {
  active: "已启用",
  connected: "已连接",
  connecting: "连接中",
  degraded: "降级",
  disabled: "未启用",
  disconnected: "未连接",
  failed: "失败",
  starting: "启动中",
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
    parts.push(status.addresses.join(", "));
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
