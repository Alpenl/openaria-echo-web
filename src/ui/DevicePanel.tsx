import { useState } from "preact/hooks";
import type { CameraFocusStatus } from "../api/types";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { connectionMethodLabel, formatBytes, formatCelsius, formatClock } from "./format";
import { CloseIcon } from "./icons";

function focusStatusText(focus: CameraFocusStatus): string {
  const manual = `手动焦距 ${focus.value}（${focus.minimum}–${focus.maximum}，步进 ${focus.step}）`;
  if (focus.auto_enabled === true) {
    return "自动对焦已开启";
  }
  if (focus.auto_supported) {
    return manual;
  }
  return `${manual}；当前相机未暴露 V4L2 focus_auto`;
}

function FocusControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const focus = runtime?.camera_focus;
  const [draft, setDraft] = useState<number | null>(null);

  // 能力不存在就不渲染控件，只留一行事实——不做一个永远点不动的表单。
  if (runtime?.camera.state !== "connected" || !focus) {
    const cameraDisconnected = runtime?.camera.state === "disconnected";
    return (
      <section class="detail-section">
        <span class="eyebrow">OPTICS</span>
        <dl class="facts">
          <div>
            <dt>手动焦距</dt>
            <dd data-testid="camera-focus-value" data-tone="caution">
              不可用
            </dd>
          </div>
        </dl>
        <p id="focus-status" class="panel-note">
          {cameraDisconnected
            ? "相机未接入"
            : "当前相机未暴露 V4L2 focus_absolute/focus_auto 控制"}
        </p>
      </section>
    );
  }

  const value = draft ?? focus.value;
  return (
    <section class="detail-section">
      <span class="eyebrow">OPTICS</span>
      <dl class="facts">
        <div>
          <dt>手动焦距</dt>
          <dd data-testid="camera-focus-value">{value}</dd>
        </div>
      </dl>
      <input
        id="camera-focus-range"
        name="value"
        type="range"
        min={focus.minimum}
        max={focus.maximum}
        step={focus.step}
        value={value}
        disabled={state.focusPending || focus.auto_enabled === true}
        aria-label="手动焦距"
        onInput={(event) => setDraft(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <p id="focus-status" class="panel-note">
        {focusStatusText(focus)}
      </p>
      <div class="chips">
        <button
          type="button"
          class="chip"
          id="focus-command"
          disabled={state.focusPending || draft === null}
          onClick={() => {
            if (draft !== null) {
              void store.setCameraFocus({ value: draft });
              setDraft(null);
            }
          }}
        >
          {state.focusPending ? "正在应用" : "应用焦距"}
        </button>
        <button
            type="button"
            class="chip"
            id="camera-focus-auto"
            aria-pressed={focus.auto_enabled === true}
            disabled={state.focusPending || !focus.auto_supported}
            onClick={() => void store.setCameraFocus({ auto_enabled: !focus.auto_enabled })}
          >
            自动对焦
          </button>
      </div>
    </section>
  );
}

/** 存储改用容量条：设备卷是 GiB 量级，一条比两行数字更快读出还能拍多久。 */
function StorageCapacity({ state }: { state: AppState }) {
  const storage = state.device?.storage;
  const total = storage?.total_bytes;
  const available = storage?.available_bytes;
  const known =
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0 &&
    typeof available === "number" &&
    Number.isFinite(available);
  if (!known) {
    return (
      <p class="panel-note" data-testid="storage-capacity">
        容量不可用
      </p>
    );
  }
  const used = Math.max(0, total - available);
  const usedPct = Math.min(100, Math.max(0, (used / total) * 100));
  return (
    <div data-testid="storage-capacity">
      <div class="capacity-bar" role="img" aria-label={`已用 ${formatBytes(used)} / 共 ${formatBytes(total)}`}>
        <i style={`width:${usedPct.toFixed(1)}%`} />
      </div>
      <div class="capacity-caption">
        <span>已用 {formatBytes(used)}</span>
        <span>
          可用 {formatBytes(available)} / {formatBytes(total)}
        </span>
      </div>
    </div>
  );
}

export function DevicePanel({ state }: { state: AppState }) {
  const device = state.device;
  const runtime = state.capture?.snapshot.runtime ?? device?.runtime ?? null;

  return (
    <aside id="device-panel" class="panel" aria-label="设备与链路">
      <div class="panel-head">
        <span class="eyebrow">DEVICE</span>
        <span class="panel-title">设备与链路</span>
        <span style="flex-grow:1" />
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
          onClick={() => {
            store.dispatch({ type: "panel.closed" });
            window.requestAnimationFrame(() =>
              document.getElementById("device-panel-trigger")?.focus(),
            );
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="panel-body">
        <section class="detail-section">
          <span class="eyebrow">RUNTIME</span>
          <dl class="facts">
            <div>
              <dt>温度</dt>
              <dd>{formatCelsius(runtime?.temperature_celsius)}</dd>
            </div>
            <div>
              <dt>连接方式</dt>
              <dd>{connectionMethodLabel(runtime?.connection_method)}</dd>
            </div>
            <div>
              <dt>相机</dt>
              <dd
                data-testid="camera-connection"
                data-tone={runtime?.camera.state === "disconnected" ? "caution" : undefined}
              >
                {runtime
                  ? runtime.camera.state === "connected"
                    ? "已连接"
                    : "未接入"
                  : "--"}
              </dd>
            </div>
            <div>
              <dt>观测于</dt>
              <dd data-tone="muted">{formatClock(runtime?.observed_at)}</dd>
            </div>
          </dl>
        </section>

        <FocusControl state={state} />

        <section class="detail-section">
          <span class="eyebrow">STORAGE</span>
          <StorageCapacity state={state} />
          <dl class="facts">
            <div>
              <dt>可写</dt>
              <dd data-tone={device?.storage.writable ? undefined : "caution"}>
                {device?.storage.writable ? "是" : "否"}
              </dd>
            </div>
            <div>
              <dt>volume</dt>
              <dd>{device?.storage.volume_id ?? "--"}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <span class="eyebrow">BUILD &amp; AUTHORITY</span>
          <dl class="facts">
            <div>
              <dt>软件包</dt>
              <dd>{device?.build?.package_version ?? "--"}</dd>
            </div>
            <div>
              <dt>Device API</dt>
              <dd>{device?.api_version ?? "--"}</dd>
            </div>
            <div>
              <dt>安全 profile</dt>
              <dd>{device?.security_profile ?? "--"}</dd>
            </div>
            <div>
              <dt>build id</dt>
              <dd>{device?.build?.build_id ?? "--"}</dd>
            </div>
            <div>
              <dt>commit</dt>
              <dd class="artifact-hash">{device?.build?.commit ?? "--"}</dd>
            </div>
            <div>
              <dt>硬件指纹</dt>
              <dd class="artifact-hash">{device?.hardware_fingerprint ?? "--"}</dd>
            </div>
            <div>
              <dt>authority epoch</dt>
              <dd class="artifact-hash">{state.capture?.authority_epoch ?? "--"}</dd>
            </div>
            <div>
              <dt>source revision</dt>
              <dd>{state.capture?.source_revision ?? "--"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
