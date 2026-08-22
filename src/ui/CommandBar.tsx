import { useEffect, useRef, useState } from "preact/hooks";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { formatCount, formatMiB, formatSeconds, formatStepProgress } from "./format";
import { CalibrationIcon, EjectIcon } from "./icons";

function useDisplayedElapsedSeconds(
  authoritativeSeconds: number,
  sessionId: string | null,
  running: boolean,
): number {
  const [displayed, setDisplayed] = useState(authoritativeSeconds);
  const anchorRef = useRef({
    sessionId,
    seconds: authoritativeSeconds,
    observedAt: performance.now(),
    running: false,
  });

  useEffect(() => {
    const observedAt = performance.now();
    const previous = anchorRef.current;
    const continuing =
      running && sessionId !== null && previous.running && previous.sessionId === sessionId;
    const extrapolated =
      previous.seconds + Math.max(0, observedAt - previous.observedAt) / 1000;
    const anchoredSeconds = continuing
      ? Math.max(authoritativeSeconds, extrapolated)
      : authoritativeSeconds;
    anchorRef.current = {
      sessionId,
      seconds: anchoredSeconds,
      observedAt,
      running,
    };
    setDisplayed((current) => (continuing ? Math.max(current, anchoredSeconds) : anchoredSeconds));

    if (!running || sessionId === null) {
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor.running || anchor.sessionId !== sessionId) {
        return;
      }
      const interpolated = anchor.seconds + (performance.now() - anchor.observedAt) / 1000;
      setDisplayed((current) => Math.max(current, interpolated));
    };
    const timer = globalThis.setInterval(update, 50);
    return () => globalThis.clearInterval(timer);
  }, [authoritativeSeconds, running, sessionId]);

  return displayed;
}

export function CommandBar({ state }: { state: AppState }) {
  const [displayName, setDisplayName] = useState("");
  const snapshot = state.capture?.snapshot;
  const deviceState = snapshot?.device_state ?? null;
  const active = snapshot?.active_recording?.recording_state ?? null;
  const progress = active?.progress ?? null;

  const connected = state.connection === "connected";
  const recording = deviceState === "recording";
  const displayedElapsed = useDisplayedElapsedSeconds(
    progress?.elapsed_seconds ?? 0,
    active?.session_id ?? null,
    connected && recording,
  );
  const captureAllowed = state.device?.capabilities.capture !== false;

  // 名称由原生 required 校验，快门只按权威状态和链路启停：事件流断开即封锁命令。
  // 卷不可写就不准入：录制准入在创建 session 之前判断，不靠事后失败收敛。
  const writable = state.device?.storage.writable === true;
  const canStart =
    Boolean(snapshot) &&
    connected &&
    captureAllowed &&
    writable &&
    deviceState === "idle" &&
    !state.commandPending;
  const canStop = connected && recording && !state.commandPending;
  const shutterLabel = state.commandPending ? "正在发送" : recording ? "结束录制" : "开始录制";

  return (
    <footer class="bottombar">
      <form
        class="command-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (recording) {
            if (canStop) {
              void store.stopCapture("user");
            }
          } else if (canStart) {
            void store.startCapture(displayName.trim());
          }
        }}
      >
        <button
          type="submit"
          class="shutter"
          data-recording={String(recording)}
          aria-label={shutterLabel}
          title={shutterLabel}
          disabled={recording ? !canStop : !canStart}
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
              required
              value={displayName}
              disabled={!connected || state.commandPending || deviceState !== "idle"}
              onInput={(event) => setDisplayName((event.currentTarget as HTMLInputElement).value)}
            />
            {!connected ? (
              <p class="command-lock">
                {state.connection === "connecting"
                  ? "等待权威事件，命令已封锁"
                  : "事件流断开，命令已封锁"}
              </p>
            ) : null}
          </>
        )}
        </div>

        <dl class="readout">
          <div>
            <dt>时长</dt>
            <dd data-testid="elapsed-seconds" data-idle={String(!progress)}>
              {formatSeconds(displayedElapsed)}
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
              {formatMiB(progress?.bytes_written ?? 0)}
            </dd>
          </div>
          <div>
            <dt>校验</dt>
            <dd data-testid="verification-progress" data-idle={String(!progress?.verification)}>
              {formatStepProgress(progress?.verification)}
            </dd>
          </div>
        </dl>
      </form>


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
          title="标定录制路径尚未在 Device API v4 暴露"
          aria-describedby="calibration-reason"
        >
          <CalibrationIcon size={17} />
          <span style="margin-left:8px">标定录制</span>
        </button>
        <span id="calibration-reason" class="visually-hidden">
          标定录制路径尚未在 Device API v4 暴露，因此这里不提供入口，也不会回退为普通生产录制。
        </span>
      </div>
    </footer>
  );
}
