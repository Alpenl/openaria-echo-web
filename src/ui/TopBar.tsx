import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { formatBytes, formatCelsius, connectionMethodLabel, deviceStateLabel } from "./format";
import { DeviceIcon, SessionsIcon } from "./icons";

const CONNECTION_LABELS: Record<AppState["connection"], string> = {
  connecting: "正在连接",
  connected: "事件流已连接",
  disconnected: "事件流断开",
};

export function TopBar({ state }: { state: AppState }) {
  const snapshot = state.capture?.snapshot;
  const deviceState = snapshot?.device_state ?? null;
  const storage = state.device?.storage;
  const runtime = snapshot?.runtime ?? state.device?.runtime ?? null;
  // 介质许可只由通过七项校验的 typed receipt 驱动，绝不从状态或列表推断。
  const released = state.safeSwapReceipt !== null;

  return (
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true" />
        <span class="brand-label">{state.device?.device.device_label ?? "Open Aria Echo"}</span>
      </div>

      <strong class="state-chip" data-testid="capture-state" data-state={deviceState ?? "unknown"}>
        {deviceStateLabel(deviceState)}
      </strong>

      <div class="topbar-facts">
        <span>
          <span data-testid="storage-available">
            {storage ? formatBytes(storage.available_bytes) : "--"}
          </span>{" "}
          <span data-testid="storage-writable">
            {storage ? (storage.writable ? "可写" : "只读") : "--"}
          </span>
        </span>
        <span data-testid="temperature">{formatCelsius(runtime?.temperature_celsius)}</span>
        <span data-testid="connection-method">
          {connectionMethodLabel(runtime?.connection_method)}
        </span>
        <span
          class="tag"
          data-testid="media-release"
          data-state={released ? "released" : "held"}
          style={released ? "color:var(--permit);border-color:var(--permit)" : undefined}
        >
          {released ? "可以移除" : "使用中"}
        </span>
        <output class="link-dot" data-state={state.connection} aria-live="polite">
          {CONNECTION_LABELS[state.connection]}
        </output>
      </div>

      <button
        type="button"
        class="icon-button"
        aria-pressed={state.panel === "sessions"}
        aria-label="会话台账"
        title="会话台账"
        onClick={() =>
          store.dispatch(
            state.panel === "sessions"
              ? { type: "panel.closed" }
              : { type: "panel.opened", panel: "sessions" },
          )
        }
      >
        <SessionsIcon />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-pressed={state.panel === "device"}
        aria-label="设备与链路"
        title="设备与链路"
        onClick={() =>
          store.dispatch(
            state.panel === "device"
              ? { type: "panel.closed" }
              : { type: "panel.opened", panel: "device" },
          )
        }
      >
        <DeviceIcon />
      </button>
    </header>
  );
}
