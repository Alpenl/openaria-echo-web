import type { AppState } from "../state/reducer";
import { OUTCOME_LABELS } from "./format";

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
    return <div class="alerts" />;
  }
  return (
    <div class="alerts">
      {state.error ? (
        <div class="alert" role="alert">
          <code>{state.error.code}</code>
          <span>{state.error.message}</span>
        </div>
      ) : null}
      {state.diagnostics.map((diagnostic) => (
        <div class="alert" role="alert" key={`${diagnostic.code}|${diagnostic.at}`}>
          <code>{diagnostic.code}</code>
          <span>{diagnostic.message}</span>
          <span class="tag" data-recoverable={String(diagnostic.recoverable)}>
            {diagnostic.recoverable ? "recoverable" : "not recoverable"}
          </span>
          {/* 诊断 details 原样呈现：设备说了什么就显示什么，不做二次解读。 */}
          {diagnostic.details && Object.keys(diagnostic.details).length > 0 ? (
            <pre>{JSON.stringify(diagnostic.details)}</pre>
          ) : null}
          <time dateTime={diagnostic.at}>{diagnostic.at}</time>
        </div>
      ))}
    </div>
  );
}
