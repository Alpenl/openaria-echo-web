import type { AppState } from "../state/reducer";
import { formatTimeOfDay } from "./format";

const OUTCOME_LABELS: Record<string, string> = {
  recoverable: "可评估残留",
  failed: "已失败",
  abandoned: "已放弃",
  media_lost: "介质丢失",
  blocked: "受阻",
};

/**
 * 危险带投影权威快照里的持久状态，不是事件流：它永远不用 role="alert"，
 * 也不会因为刷新页面而把旧的终态重放成新告警。
 */
export function HazardBand({ state }: { state: AppState }) {
  const retained = state.capture?.snapshot.retained_unsuccessful;
  if (!retained) {
    return null;
  }
  const outcome = retained.recording_state.state;
  return (
    <section class="hazard" role="status" aria-label="设备危险状态">
      <span class="hazard-mark" aria-hidden="true" />
      <p>上一次录制没有成功封存</p>
      <strong class="hazard-outcome" data-testid="retained-outcome">
        {OUTCOME_LABELS[outcome] ?? outcome}
      </strong>
      <code class="hazard-session" data-testid="retained-session">
        {retained.recording_state.session_id}
      </code>
      <span class="tag">{retained.recording_state.display_name}</span>
    </section>
  );
}

export function Alerts({ state }: { state: AppState }) {
  if (state.diagnostics.length === 0 && !state.error) {
    return <div class="alerts" aria-live="assertive" aria-atomic="true" />;
  }
  return (
    <div class="alerts" aria-live="assertive" aria-atomic="true">
      {state.error ? (
        <div class="alert">
          <code>{state.error.code}</code>
          <span>{state.error.message}</span>
        </div>
      ) : null}
      {state.diagnostics.map((diagnostic) => (
        <div class="alert" key={`${diagnostic.code}|${diagnostic.at}`}>
          <code>{diagnostic.code}</code>
          <span>{diagnostic.message}</span>
          <span class="tag" data-recoverable={String(diagnostic.recoverable)}>
            {diagnostic.recoverable ? "recoverable" : "not recoverable"}
          </span>
          <time dateTime={diagnostic.at}>{formatTimeOfDay(diagnostic.at)}</time>
        </div>
      ))}
    </div>
  );
}
