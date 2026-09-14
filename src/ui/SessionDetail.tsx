import { useEffect, useRef, useState } from "preact/hooks";
import { deviceApi } from "../api/client";
import type { SessionArtifact, SessionDetail as SessionDetailManifest } from "../api/types";
import type { AppState, VisibleError } from "../state/reducer";
import { store, visibleError } from "../state/store";
import { formatBytes, formatClock, formatSeconds } from "./format";
import { BackIcon, CloseIcon, DownloadIcon } from "./icons";

/**
 * 从不可变 manifest 里按声明的角色收集 artifact。
 * 绝不从 path 或 object key 反推角色，也绝不构造 manifest 没有声明的条目。
 */
function collectArtifacts(detail: SessionDetailManifest): SessionArtifact[] {
  const artifacts: SessionArtifact[] = [];
  for (const segment of detail.video?.segments ?? []) {
    if (segment.artifacts.left) {
      artifacts.push(segment.artifacts.left);
    }
    if (segment.artifacts.right) {
      artifacts.push(segment.artifacts.right);
    }
  }
  for (const segment of detail.audio?.segments ?? []) {
    artifacts.push(segment.artifact);
  }
  if (detail.frames?.artifact) {
    artifacts.push(detail.frames.artifact);
  }
  if (detail.imu?.artifact) {
    artifacts.push(detail.imu.artifact);
  }
  for (const entry of detail.logs ?? []) {
    if (entry.artifact) {
      artifacts.push(entry.artifact);
    }
  }
  return artifacts;
}

function Head({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div class="panel-head">
      <button type="button" class="icon-button" aria-label="返回会话台账" onClick={onBack}>
        <BackIcon />
      </button>
      <span class="panel-title" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        {title}
      </span>
      <span style="flex-grow:1" />
      <button
        type="button"
        class="icon-button"
        aria-label="关闭"
        onClick={() => store.dispatch({ type: "panel.closed" })}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function SessionReplay({
  detail,
  enabled,
}: {
  detail: SessionDetailManifest;
  enabled: boolean;
}) {
  const segments = detail.video?.segments ?? [];
  const playableSegments = segments.filter(
    (segment) => segment.artifacts.left || segment.artifacts.right,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);
  const syncingRef = useRef(false);
  const [playbackError, setPlaybackError] = useState(false);

  if (!playableSegments.length) {
    return null;
  }

  const segment = playableSegments[selectedIndex] ?? playableSegments[0];
  if (!segment) {
    return null;
  }
  const audio = detail.audio?.segments.find((entry) => entry.index === segment.index)?.artifact;
  const artifactSource = (artifact: SessionArtifact | undefined) =>
    artifact ? deviceApi.artifactUrl(detail.session_id, artifact.artifact_id) : undefined;
  const sync = (source: HTMLVideoElement, action: (target: HTMLVideoElement) => void) => {
    if (syncingRef.current) {
      return;
    }
    const target = source === leftRef.current ? rightRef.current : leftRef.current;
    if (!target) {
      return;
    }
    syncingRef.current = true;
    action(target);
    globalThis.setTimeout(() => {
      syncingRef.current = false;
    }, 0);
  };

  return (
    <section class="detail-section replay-section" data-testid="session-replay">
      <span class="eyebrow">REPLAY</span>
      <div class="replay-toolbar">
        <label>
          <span>视频分段</span>
          <select
            value={String(segment.index)}
            onChange={(event) => {
              const next = Number((event.currentTarget as HTMLSelectElement).value);
              const position = playableSegments.findIndex((entry) => entry.index === next);
              setPlaybackError(false);
              setSelectedIndex(position >= 0 ? position : 0);
            }}
            data-testid="replay-segment"
          >
            {playableSegments.map((entry, position) => (
              <option value={String(entry.index)} key={entry.index}>
                #{entry.index + 1}
                {entry.start_time_seconds !== undefined && entry.end_time_seconds !== undefined
                  ? ` · ${formatSeconds(entry.end_time_seconds - entry.start_time_seconds)}`
                  : ""}
                {position === 0 ? "（首段）" : ""}
              </option>
            ))}
          </select>
        </label>
        <span class="replay-hint">
          {enabled ? "播放时按当前会话做完整字节校验" : "设备未声明 Range 回放能力"}
        </span>
      </div>
      <div class="replay-grid">
        {(["left", "right"] as const).map((eye) => {
          const artifact = segment.artifacts[eye];
          return (
            <div class="replay-player" key={eye}>
              <span class="artifact-role">{eye === "left" ? "左目" : "右目"}</span>
              {artifact && enabled ? (
                <video
                  ref={eye === "left" ? leftRef : rightRef}
                  controls
                  playsInline
                  preload="metadata"
                  src={artifactSource(artifact)}
                  data-testid={`replay-${eye}`}
                  onError={() => setPlaybackError(true)}
                  onPlay={(event) => sync(event.currentTarget, (target) => void target.play())}
                  onPause={(event) => sync(event.currentTarget, (target) => target.pause())}
                  onSeeked={(event) =>
                    sync(event.currentTarget, (target) => {
                      target.currentTime = event.currentTarget.currentTime;
                    })
                  }
                />
              ) : (
                <div class="replay-unavailable">{artifact ? "设备不支持 Range 回放" : "此分段无制品"}</div>
              )}
            </div>
          );
        })}
      </div>
      {audio && enabled ? (
        <label class="replay-audio">
          <span class="artifact-role">音频</span>
          <audio controls preload="metadata" src={artifactSource(audio)} />
        </label>
      ) : null}
      {playbackError ? (
        <p class="panel-note" role="alert">
          回放制品无法读取；设备会在首次播放时完成校验，请稍后重试或检查会话是否已被替换。
        </p>
      ) : null}
    </section>
  );
}

export function SessionDetail({ state, requestDelete = false }: {
  state: AppState;
  requestDelete?: boolean;
}) {
  const selected = state.selected;
  if (!selected) {
    return null;
  }
  const back = () => store.closeSession();
  const summary = state.sessions.items.find((item) => item.session_id === selected.sessionId);
  const title = summary?.display_name ?? selected.sessionId;
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<VisibleError | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteConfirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requestedOnce = useRef(false);

  useEffect(() => {
    if (requestDelete && selected.detail && !requestedOnce.current) {
      requestedOnce.current = true;
      const digest = selected.manifestSha256;
      if (
        state.device?.capabilities.session_deletion &&
        selected.detail.sealed && digest && /^[0-9a-f]{64}$/.test(digest)
      ) {
        deleteConfirmationTriggerRef.current = deleteTriggerRef.current;
        setDeleteConfirmation(true);
      }
    }
  }, [requestDelete, selected.detail, selected.manifestSha256]);

  useEffect(() => {
    if (!deleteConfirmation) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const trigger = deleteConfirmationTriggerRef.current;
      deleteConfirmationTriggerRef.current = null;
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) {
          trigger.focus();
        }
      });
    };
  }, [deleteConfirmation]);

  if (selected.loading) {
    return (
      <aside class="panel" aria-label="会话详情">
        <Head title={title} onBack={back} />
        <div class="panel-body">
          <p class="panel-empty">正在读取不可变清单</p>
        </div>
      </aside>
    );
  }

  if (selected.error) {
    return (
      <aside class="panel" aria-label="会话详情">
        <Head title={title} onBack={back} />
        <div class="panel-body">
          <div class="alert">
            <code>{selected.error.code}</code>
            <span>{selected.error.message}</span>
          </div>
        </div>
      </aside>
    );
  }

  // 未成功会话走只读结果接口：展示它不隐含 recovery，也没有下载入口。
  if (!selected.detail) {
    const outcome = selected.outcome;
    return (
      <aside class="panel" aria-label="未成功会话结果">
        <Head title={title} onBack={back} />
        <div class="panel-body">
          <section class="detail-section">
            <span class="eyebrow">RETAINED OUTCOME</span>
            <dl class="facts">
              <div>
                <dt>session</dt>
                <dd>{selected.sessionId}</dd>
              </div>
              <div>
                <dt>终态</dt>
                <dd data-tone="caution">{outcome?.outcome ?? summary?.producer_outcome ?? "未知"}</dd>
              </div>
            </dl>
            <p style="font-size:12px;color:var(--ink-3);text-wrap:pretty">
              这是只读结果查询，不触发任何 salvage 或恢复；未成功会话不提供下载或导出。
            </p>
          </section>
          {outcome ? (
            <section class="detail-section">
              <span class="eyebrow">RAW</span>
              <pre
                style="margin:0;font-family:var(--mono);font-size:11px;color:var(--ink-2);white-space:pre-wrap;word-break:break-all"
              >
                {JSON.stringify(outcome, null, 2)}
              </pre>
            </section>
          ) : (
            <p class="panel-empty">设备没有为这个 session 保留可查询的结果。</p>
          )}
        </div>
      </aside>
    );
  }

  const detail = selected.detail;
  const artifacts = collectArtifacts(detail);
  const verdict = summary?.verification?.verdict ?? null;
  // 门禁：只有消费方独立判为 usable 且设备声明 range_download 时才出现下载入口。
  const downloadable = verdict === "usable" && state.device?.capabilities.range_download === true;
  const deletionSupported = state.device?.capabilities.session_deletion === true;
  const manifestSha256 = selected.manifestSha256 ?? null;
  const hasManifestDigest =
    typeof manifestSha256 === "string" && /^[0-9a-f]{64}$/i.test(manifestSha256);
  const deletionReady = deletionSupported && detail.sealed && hasManifestDigest && !deletePending;

  const confirmDelete = async () => {
    if (!deletionReady || manifestSha256 === null) {
      return;
    }
    setDeletePending(true);
    deleteDialogRef.current?.focus();
    setDeleteError(null);
    try {
      const result = await store.deleteSession(detail.session_id, manifestSha256);
      if (!result.deleted_session_ids.includes(detail.session_id)) {
        const failure = result.failed_sessions.find(
          (entry) => entry.session_id === detail.session_id,
        );
        setDeleteError({
          code: failure?.error ?? "session_delete_failed",
          message: failure ? `删除失败：${failure.error}` : "设备没有确认删除此会话",
        });
        return;
      }
      setDeletePending(false);
      setDeleteConfirmation(false);
      store.closeSession();
    } catch (error) {
      setDeleteError(visibleError(error));
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <aside class="panel" aria-label="会话详情">
      <Head title={detail.display_name} onBack={back} />
      <div class="panel-body">
        <section class="detail-section">
          <span class="eyebrow">OUTCOME</span>
          <dl class="verdict-stamps">
            <div class="verdict-stamp" data-tone={detail.sealed ? "permit" : "caution"}>
              <dt>生产方声明</dt>
              <dd>{detail.sealed ? "SEALED" : "NOT SEALED"}</dd>
              <span class="stamp-sub">封存 {formatClock(detail.sealed_at)}</span>
            </div>
            <div
              class="verdict-stamp"
              data-tone={verdict === "usable" ? "permit" : verdict === "unusable" ? "fault" : "caution"}
            >
              <dt>消费方判断</dt>
              <dd>{verdict ? verdict.toUpperCase() : "尚未校验"}</dd>
              <span class="stamp-sub">
                {summary?.verification?.verified_at
                  ? `gateway ${formatClock(summary.verification.verified_at)}`
                  : "尚未校验"}
              </span>
            </div>
          </dl>
          <dl class="facts">
            <div>
              <dt>manifest sha256</dt>
              <dd class="artifact-hash">{summary?.verification?.manifest_sha256 ?? "--"}</dd>
            </div>
          </dl>
          <p style="font-size:12px;color:var(--ink-3);text-wrap:pretty">
            sealed 只证明生产方给出自洽声明；能否消费由 gateway 对当前字节独立判定，两者分开显示。
          </p>
        </section>

        <section class="detail-section">
          <span class="eyebrow">IDENTITY</span>
          <dl class="facts">
            <div>
              <dt>session</dt>
              <dd>{detail.session_id}</dd>
            </div>
            <div>
              <dt>take</dt>
              <dd>
                {detail.take.take_id} · #{detail.take.sequence}
              </dd>
            </div>
            <div>
              <dt>continuation_of</dt>
              <dd data-tone="muted">{detail.take.continuation_of ?? "无"}</dd>
            </div>
            <div>
              <dt>manifest</dt>
              <dd>{detail.manifest_id}</dd>
            </div>
            <div>
              <dt>volume</dt>
              <dd>{detail.volume_id}</dd>
            </div>
            <div>
              <dt>capture_mode</dt>
              <dd>{detail.capture_mode}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <span class="eyebrow">CAPTURE</span>
          <dl class="facts">
            <div>
              <dt>时长</dt>
              <dd>{formatSeconds(detail.time.duration_seconds)}</dd>
            </div>
            <div>
              <dt>起止</dt>
              <dd>
                {formatClock(detail.time.started_at)} → {formatClock(detail.time.ended_at)}
              </dd>
            </div>
            {detail.camera ? (
              <div>
                <dt>画面</dt>
                <dd>
                  {detail.camera.width}×{detail.camera.height} · {detail.camera.nominal_fps} fps
                </dd>
              </div>
            ) : null}
            {detail.frames ? (
              <div>
                <dt>帧数</dt>
                <dd>{detail.frames.count}</dd>
              </div>
            ) : null}
            {detail.integrity ? (
              <div>
                <dt>丢帧</dt>
                <dd data-tone={detail.integrity.dropped_frames > 0 ? "caution" : "permit"}>
                  {detail.integrity.dropped_frames}
                </dd>
              </div>
            ) : null}
            {detail.video ? (
              <div>
                <dt>视频</dt>
                <dd>
                  {detail.video.codec}/{detail.video.container} · {detail.video.layout}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section class="detail-section">
          <span class="eyebrow">ARTIFACTS · {artifacts.length}</span>
          {!downloadable ? (
            <p style="font-size:12px;color:var(--caution);text-wrap:pretty">
              {verdict === "usable"
                ? "本机未声明 range_download 能力，因此不提供下载。"
                : "只有消费方独立判为可用的不可变快照才提供下载。"}
            </p>
          ) : null}
          {artifacts.map((artifact) => (
            <div class="artifact" key={artifact.artifact_id}>
              <div class="artifact-body">
                <span class="artifact-role">{artifact.role}</span>
                <span class="artifact-path">{artifact.path}</span>
                <span class="artifact-hash">sha256:{artifact.sha256}</span>
              </div>
              <span class="artifact-size">{formatBytes(artifact.bytes)}</span>
              <a
                class="download"
                aria-disabled={!downloadable}
                href={
                  downloadable
                    ? deviceApi.artifactUrl(detail.session_id, artifact.artifact_id)
                    : undefined
                }
                download={artifact.path.split("/").pop()}
                rel="noreferrer"
              >
                <DownloadIcon size={15} />
                <span style="margin-left:6px">下载</span>
              </a>
            </div>
          ))}
        </section>

        <SessionReplay
          detail={detail}
          enabled={state.device?.capabilities.range_download === true}
        />
      </div>
      <section class="detail-section session-delete" aria-label="录制操作">
        {deleteError && !deleteConfirmation ? (
          <div class="alert" role="alert">
            <code>{deleteError.code}</code>
            <span>{deleteError.message}</span>
          </div>
        ) : null}
        <button
          ref={deleteTriggerRef}
          type="button"
          class="panel-danger"
          data-testid="delete-session"
          disabled={!deletionReady}
          aria-disabled={!deletionReady}
          onClick={() => {
            if (deletionReady) {
              deleteConfirmationTriggerRef.current = deleteTriggerRef.current;
              setDeleteError(null);
              setDeleteConfirmation(true);
            }
          }}
        >
          {deletePending ? "正在删除" : "删除此会话"}
        </button>
        {!deletionSupported ? (
          <p class="panel-note">当前固件未声明远程删除能力。</p>
        ) : !hasManifestDigest ? (
          <p class="panel-note">该会话尚未完成网关校验，暂不能安全删除。</p>
        ) : null}

        {deleteConfirmation ? (
          <div class="delete-backdrop">
            <div
              ref={deleteDialogRef}
              class="network-confirm danger session-delete-confirm"
              role="alertdialog"
              tabIndex={-1}
              aria-modal="true"
              aria-labelledby="session-delete-title"
              aria-describedby="session-delete-description"
              aria-busy={deletePending}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !deletePending) {
                  event.preventDefault();
                  setDeleteConfirmation(false);
                }
                if (event.key === "Tab") {
                  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                  const first = buttons[0];
                  const last = buttons[buttons.length - 1];
                  if (!first) {
                    event.preventDefault();
                  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                    event.preventDefault();
                    last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <strong id="session-delete-title">永久删除“{detail.display_name}”？</strong>
              <p id="session-delete-description">
                将删除设备上这次录制的全部文件，无法撤销。已下载的本地文件不受影响。
              </p>
              {deleteError ? <p role="alert">{deleteError.message}</p> : null}
              <div class="network-confirm-actions">
                <button
                  type="button"
                  class="panel-danger"
                  disabled={deletePending}
                  onClick={() => void confirmDelete()}
                >
                  {deletePending ? "正在删除" : "确认删除"}
                </button>
                <button
                  ref={deleteCancelRef}
                  type="button"
                  class="panel-secondary"
                  disabled={deletePending}
                  onClick={() => setDeleteConfirmation(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
