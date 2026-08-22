import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import {
  CONNECTION_LABELS,
  connectionMethodLabel,
  deviceStateLabel,
  formatCelsius,
  formatGiB,
} from "./format";
import { DeviceIcon, SessionsIcon } from "./icons";

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
        <h1 class="visually-hidden">Open Aria Echo</h1>
        <span class="brand-mark" aria-hidden="true" />
        <span class="brand-label">{state.device?.device.device_label ?? "Open Aria Echo"}</span>
      </div>

      <strong class="state-chip" data-testid="capture-state" data-state={deviceState ?? "unknown"}>
        {deviceStateLabel(deviceState)}
      </strong>

      <div class="topbar-facts">
        <span>
          <span data-testid="storage-available">
            {storage ? formatGiB(storage.available_bytes) : "--"}
          </span>{" "}
          <span data-testid="storage-writable">
            {storage ? (storage.writable ? "可写" : "不可写") : "--"}
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
          {released ? "可移除" : "使用中"}
        </span>
        <output class="connection link-dot" data-state={state.connection} aria-live="polite">
          {CONNECTION_LABELS[state.connection] ?? state.connection}
        </output>
      </div>

      <button
        type="button"
        class="icon-button"
        aria-pressed={state.panel === "sessions"}
        aria-label="会话台账"
        title="会话台账"
        onClick={() => {
          const opening = state.panel !== "sessions";
          store.dispatch(
            opening ? { type: "panel.opened", panel: "sessions" } : { type: "panel.closed" },
          );
          if (opening) {
            void store.refreshSessions();
          }
        }}
      >
        <SessionsIcon />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-pressed={state.panel === "device"}
        aria-label="设备与链路"
        title="设备与链路"
        onClick={() => {
          const opening = state.panel !== "device";
          store.dispatch(
            opening ? { type: "panel.opened", panel: "device" } : { type: "panel.closed" },
          );
          if (opening) {
            void store.refreshNetwork();
          }
        }}
      >
        <DeviceIcon />
      </button>
    </header>
  );
}
