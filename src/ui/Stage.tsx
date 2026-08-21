import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { formatVector, imuSyncLabel } from "./format";
import { ExpandIcon } from "./icons";
import type { PreviewState } from "../api/preview";

const INSPECT_MODES = [
  { mode: "both", label: "双目" },
  { mode: "left", label: "左眼" },
  { mode: "right", label: "右眼" },
] as const;

const PREVIEW_MESSAGES: Record<PreviewState, string> = {
  live: "实时",
  waiting: "等待设备画面",
  unavailable: "画面暂不可用",
};

/**
 * 画面层铺满整个视口，顶栏、底栏和面板都浮在它之上。
 * 并置双目永远用 contain：取景是操作者判断构图的依据，不能替他裁掉视野。
 * 单眼取景默认铺满（裁切），并明确标注可以切回全画幅。
 */
export function Stage({
  state,
  frameUrl,
  previewState,
}: {
  state: AppState;
  frameUrl: string | null;
  previewState: PreviewState;
}) {
  const previewSupported = state.device?.capabilities.preview !== false;

  return (
    <div class="frame" data-inspect={state.inspect} data-full={String(state.fullFrame)}>
      <img
        data-testid="preview-image"
        src={frameUrl ?? undefined}
        alt="设备实时预览"
        hidden={!frameUrl}
      />
      {!frameUrl ? (
        <p class="frame-empty">
          <span class="eyebrow">PREVIEW</span>
          <span>{previewSupported ? PREVIEW_MESSAGES[previewState] : "本机不提供预览"}</span>
        </p>
      ) : null}
    </div>
  );
}

export function StageOverlays({ state }: { state: AppState }) {
  const imu = state.capture?.snapshot.runtime.live_imu ?? null;
  const singleEye = state.inspect !== "both";

  return (
    <div class="stage-left">
      <div class="inspect" data-testid="preview-inspect" role="group" aria-label="预览取景">
        {INSPECT_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={state.inspect === mode}
            onClick={() => store.dispatch({ type: "inspect.changed", mode })}
          >
            {label}
          </button>
        ))}
      </div>

      <dl class="overlay-card">
        <span class="eyebrow">RAW IMU</span>
        <div class="imu-row">
          <dt>a</dt>
          <dd data-testid="acceleration" data-available={String(Boolean(imu))}>
            {imu ? formatVector(imu.raw.accelerometer) : "不可用"}
          </dd>
        </div>
        <div class="imu-row">
          <dt>ω</dt>
          <dd data-testid="angular-velocity" data-available={String(Boolean(imu))}>
            {imu ? formatVector(imu.raw.gyroscope) : "不可用"}
          </dd>
        </div>
        <div class="imu-row">
          <dt aria-label="同步质量">≈</dt>
          <dd data-testid="imu-sync" data-available={String(Boolean(imu))}>
            {imu ? imuSyncLabel(imu.sync.quality) : "不可用"}
          </dd>
        </div>
      </dl>

      {singleEye ? (
        <button
          type="button"
          class="crop-note"
          onClick={() => store.dispatch({ type: "full-frame.toggled" })}
        >
          <ExpandIcon size={15} />
          {state.fullFrame ? "全画幅 · 回到铺满" : "已裁切取景 · 看全画幅"}
        </button>
      ) : null}
    </div>
  );
}
