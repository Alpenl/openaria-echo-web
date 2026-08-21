import { deviceApi } from "../api/client";
import type { SessionArtifact, SessionDetail as SessionDetailManifest } from "../api/types";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
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

export function SessionDetail({ state }: { state: AppState }) {
  const selected = state.selected;
  if (!selected) {
    return null;
  }
  const back = () => store.closeSession();
  const summary = state.sessions.items.find((item) => item.session_id === selected.sessionId);
  const title = summary?.display_name ?? selected.sessionId;

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

  return (
    <aside class="panel" aria-label="会话详情">
      <Head title={detail.display_name} onBack={back} />
      <div class="panel-body">
        <section class="detail-section">
          <span class="eyebrow">OUTCOME</span>
          <dl class="facts">
            <div>
              <dt>生产方声明</dt>
              <dd data-tone={detail.sealed ? "permit" : "caution"}>
                {detail.sealed ? "sealed" : "not sealed"}
              </dd>
            </div>
            <div>
              <dt>消费方判断</dt>
              <dd
                data-tone={verdict === "usable" ? "permit" : verdict === "unusable" ? "fault" : "caution"}
              >
                {verdict ?? "尚未校验"}
              </dd>
            </div>
            <div>
              <dt>封存于</dt>
              <dd>{formatClock(detail.sealed_at)}</dd>
            </div>
            <div>
              <dt>校验于</dt>
              <dd data-tone="muted">{formatClock(summary?.verification?.verified_at)}</dd>
            </div>
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
      </div>
    </aside>
  );
}
