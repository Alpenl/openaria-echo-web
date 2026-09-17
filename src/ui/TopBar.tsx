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

export function TopBar({ state, onVersion }: { state: AppState; onVersion: () => void }) {
  const snapshot = state.capture?.snapshot;
  const deviceState = snapshot?.device_state ?? null;
  const storage = state.device?.storage;
  const runtime = snapshot?.runtime ?? state.device?.runtime ?? null;
  const connectionMethod = connectionMethodLabel(runtime?.connection_method);

  return (
    <header class="topbar">
      <div class="brand">
        <h1 class="visually-hidden">Open Aria Echo</h1>
        <span class="brand-mark" aria-hidden="true" />
        <span class="brand-label">{state.device?.device.device_label ?? "Open Aria Echo"}</span>
        <button type="button" class="version-badge" aria-label="版本与更新" onClick={onVersion}>
          {state.device?.build?.package_version ? `v${state.device.build.package_version}` : "版本"}
        </button>
      </div>

      <strong class="state-chip" data-testid="capture-state" data-state={deviceState ?? "unknown"}>
        {deviceState === "recording" ? <span class="rec-block" aria-hidden="true" /> : null}
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
        <button
          id="network-panel-trigger"
          type="button"
          class="connection-method-trigger"
          aria-pressed={state.panel === "network"}
          aria-controls="network-panel"
          aria-label="网络设置"
          aria-describedby="connection-method-label"
          title="网络设置"
          onClick={() => {
            const opening = state.panel !== "network";
            store.dispatch(
              opening ? { type: "panel.opened", panel: "network" } : { type: "panel.closed" },
            );
            if (opening) {
              void store.refreshNetwork();
            }
          }}
        >
          <span id="connection-method-label" data-testid="connection-method">
            {connectionMethod}
          </span>
        </button>
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
        id="device-panel-trigger"
        type="button"
        class="icon-button"
        aria-pressed={state.panel === "device"}
        aria-controls="device-panel"
        aria-label="设备与链路"
        title="设备与链路"
        onClick={() => {
          const opening = state.panel !== "device";
          store.dispatch(
            opening ? { type: "panel.opened", panel: "device" } : { type: "panel.closed" },
          );
          if (opening) {
            void store.refreshDevice();
          }
        }}
      >
        <DeviceIcon />
      </button>
    </header>
  );
}
