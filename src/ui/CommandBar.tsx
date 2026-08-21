import { useState } from "preact/hooks";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { formatBytes, formatCount, formatSeconds, formatStepProgress } from "./format";
import { CalibrationIcon, EjectIcon } from "./icons";

const ACTIVE_STATES = new Set(["recording", "finalizing", "encoding", "verifying"]);

export function CommandBar({ state }: { state: AppState }) {
  const [displayName, setDisplayName] = useState("");
  const snapshot = state.capture?.snapshot;
  const deviceState = snapshot?.device_state ?? null;
  const active = snapshot?.active_recording?.recording_state ?? null;
  const progress = active?.progress ?? null;

  const connected = state.connection === "connected";
  const recording = deviceState === "recording";
  const busy = deviceState !== null && ACTIVE_STATES.has(deviceState);
  const captureAllowed = state.device?.capabilities.capture !== false;

  const canStart =
    connected && captureAllowed && deviceState === "idle" && !state.commandPending && displayName.trim().length > 0;
  const canStop = connected && recording && !state.commandPending;

  const shutterLabel = recording ? "结束录制" : "开始录制";

  return (
    <footer class="bottombar">
      <button
        type="button"
        class="shutter"
        data-recording={String(recording)}
        aria-label={shutterLabel}
        title={shutterLabel}
        disabled={recording ? !canStop : !canStart}
        onClick={() => {
          if (recording) {
            void store.stopCapture("user");
          } else if (canStart) {
            void store.startCapture(displayName.trim());
          }
        }}
      >
        <span class="shutter-dot" aria-hidden="true" />
      </button>

      <div class="command-body">
        {active ? (
          <>
            <span class="eyebrow">当前会话</span>
            <span class="session-title" data-testid="current-session-name">
              {active.display_name}
            </span>
            <code class="session-uuid">{active.session_id}</code>
          </>
        ) : (
          <>
            <label class="eyebrow" for="capture-name">
              录制名称
            </label>
            <input
              id="capture-name"
              class="name-input"
              type="text"
              maxLength={160}
              autocomplete="off"
              placeholder="例如：走廊采集 01"
              value={displayName}
              disabled={!connected || busy || state.commandPending}
              onInput={(event) => setDisplayName((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canStart) {
                  void store.startCapture(displayName.trim());
                }
              }}
            />
            {!connected ? <p class="command-lock">事件流断开，命令已封锁</p> : null}
          </>
        )}
      </div>

      <dl class="readout">
        <div>
          <dt>时长</dt>
          <dd data-testid="elapsed-seconds" data-idle={String(!progress)}>
            {formatSeconds(progress?.elapsed_seconds ?? 0)}
          </dd>
        </div>
        <div>
          <dt>帧数</dt>
          <dd data-testid="captured-frames" data-idle={String(!progress)}>
            {formatCount(progress?.captured_frames ?? 0)}
          </dd>
        </div>
        <div>
          <dt>写入</dt>
          <dd data-testid="bytes-written" data-idle={String(!progress)}>
            {formatBytes(progress?.bytes_written ?? 0)}
          </dd>
        </div>
        <div>
          <dt>校验</dt>
          <dd data-testid="verification-progress" data-idle={String(!progress?.verification)}>
            {formatStepProgress(progress?.verification)}
          </dd>
        </div>
      </dl>

      <div class="command-actions">
        <button
          type="button"
          class="command-button"
          data-tone="danger"
          disabled={!canStop}
          title="结束并封存当前会话，等待设备释放存储介质"
          onClick={() => void store.stopCapture("safe_swap")}
        >
          <EjectIcon size={17} />
          <span style="margin-left:8px">安全换盘</span>
        </button>
        <button
          type="button"
          class="command-button"
          disabled
          title="标定录制路径尚未在 Device API v3 暴露"
          aria-describedby="calibration-reason"
        >
          <CalibrationIcon size={17} />
          <span style="margin-left:8px">标定录制</span>
        </button>
        <span id="calibration-reason" class="visually-hidden">
          标定录制路径尚未在 Device API v3 暴露，因此这里不提供入口，也不会回退为普通生产录制。
        </span>
      </div>
    </footer>
  );
}
