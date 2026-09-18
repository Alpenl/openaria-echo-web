import { useEffect, useRef, useState } from "preact/hooks";
import { DeviceApiError, deviceApi, idempotencyKey } from "../api/client";
import { getFirmware, startFirmware, type FirmwareStatus } from "../api/firmware";
import type { AppState } from "../state/reducer";
import { CloseIcon } from "./icons";

export function FirmwarePanel({ state, onClose }: { state: AppState; onClose: () => void }) {
  const [status, setStatus] = useState<FirmwareStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "update" | "rollback"; commit: string; version: string } | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const alive = useRef(true);
  const pageCommit = useRef(state.device?.build?.commit);
  const generation = useRef(0);
  const submitting = useRef(false);
  const checking = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const progress = useRef<HTMLElement>(null);
  const [trackedTask, setTrackedTask] = useState<string | null>(null);
  const [live, setLive] = useState<{ commit: string | null; idle: boolean } | null>(null);
  const pending = useRef<{ action: "update" | "rollback"; commit: string; key: string } | null>(null);
  const task = status?.task;
  const active = task?.status === "accepted" || task?.status === "running";
  // A stored receipt belongs to an earlier operation unless this page observed
  // it running, submitted it, or still serves the version it replaced.
  const visibleTask = task && (active || task.id === trackedTask ||
    (task.status === "succeeded" && task.target_commit === status?.current?.commit &&
      !!pageCommit.current && task.target_commit !== pageCommit.current)) ? task : null;
  const completed = visibleTask?.status === "succeeded" && visibleTask.finished_at !== null &&
    visibleTask.target_commit === status?.current?.commit && live?.commit === visibleTask.target_commit && !disconnected;
  const verifying = visibleTask?.status === "succeeded" && !completed;
  const busy = active || verifying;
  const idle = live?.idle === true;
  const version = status?.current?.version ?? state.device?.build?.package_version;

  async function refresh(check = false, foreground = true) {
    if (submitting.current || (!foreground && checking.current)) return;
    const revision = ++generation.current;
    if (foreground) { checking.current = true; setLoading(true); setError(null); }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const [firmware, device, capture] = await Promise.allSettled([
        getFirmware(check, check), deviceApi.getDevice(controller.signal), deviceApi.getCaptureStatus(controller.signal),
      ]);
      if (!alive.current || revision !== generation.current) return;
      if (firmware.status === "rejected") throw firmware.reason;
      const result = firmware.value;
      setStatus(result); setUnavailable(false);
      if (result.task?.status === "accepted" || result.task?.status === "running") setTrackedTask(result.task.id);
      if (device.status === "fulfilled" && capture.status === "fulfilled") {
        setLive({ commit: device.value.build?.commit ?? null, idle: capture.value.snapshot.device_state === "idle" });
        setDisconnected(false);
      } else { setLive(null); setDisconnected(true); }
    } catch (failure) {
      if (alive.current && revision === generation.current) {
        setLive(null); setDisconnected(true);
        setUnavailable(failure instanceof DeviceApiError && failure.status === 404);
        if (foreground) setError(failure instanceof Error ? failure.message : "无法读取更新状态");
      }
    } finally {
      window.clearTimeout(timeout);
      if (foreground) { checking.current = false; if (alive.current) setLoading(false); }
    }
  }

  useEffect(() => {
    alive.current = true;
    void refresh();
    let running = false;
    const timer = window.setInterval(async () => {
      if (running) return;
      running = true;
      try { await refresh(false, false); }
      finally { running = false; }
    }, 2500);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => { if (confirm) confirmButton.current?.focus(); }, [confirm]);
  useEffect(() => { if (visibleTask) progress.current?.scrollIntoView({ block: "nearest" }); }, [visibleTask?.id, completed, verifying]);

  async function submit() {
    if (!status || !confirm) return;
    const target = confirm;
    const previous = pending.current;
    const operation = previous?.action === confirm.action && previous.commit === target.commit ? previous :
      { action: confirm.action, commit: target.commit, key: idempotencyKey() };
    pending.current = operation;
    submitting.current = true;
    generation.current++;
    setLoading(true); setError(null);
    try {
      const task = await startFirmware(operation.action, operation.commit, operation.key);
      if (alive.current) {
        setTrackedTask(task.id);
        setStatus({ ...status, task }); setConfirm(null); pending.current = null;
      }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "请查询设备任务状态后重试");
    } finally { submitting.current = false; if (alive.current) { setLoading(false); void refresh(false, false); } }
  }

  return <aside class="panel firmware-panel" aria-label="版本与更新">
    <div class="panel-head">
      <span class="panel-title">版本与更新</span>
      <button type="button" class="icon-button" aria-label="关闭版本面板" onClick={onClose}><CloseIcon /></button>
    </div>
    <div class="panel-body">
      <section class="detail-section">
        <span class="eyebrow">当前版本</span>
        <strong class="firmware-version">{version ? `v${version}` : "读取中…"}</strong>
        <p class="panel-note">{(status?.current?.commit ?? state.device?.build?.commit ?? "").slice(0, 12)}</p>
        <button type="button" class="chip" disabled={loading || busy || unavailable} onClick={() => void refresh(true)}>
          {loading ? "正在处理…" : "检查更新"}
        </button>
      </section>
      {unavailable ? <p class="panel-note">当前固件尚不支持网页更新。请先通过设备更新命令升级一次。</p> : null}
      {error ? <p role="alert" class="firmware-error">{error}</p> : null}
      {status?.warning ? <p role="alert" class="firmware-error">{status.warning}</p> : null}
      {disconnected ? <p role="status">设备暂时断开，正在等待重新连接并查询任务结果…</p> : null}
      {visibleTask ? <section ref={progress} class="detail-section" aria-live="polite">
        <strong>{completed ? "操作完成" : verifying ? "正在确认更新结果" : visibleTask.status === "failed" ? "操作失败" : visibleTask.action === "rollback" ? "正在回退" : "正在更新"}</strong>
        <p>{verifying ? "正在等待目标版本启动并恢复设备连接…" : visibleTask.message}</p>
        {completed ? <button type="button" class="chip" onClick={() => window.location.reload()}>刷新页面</button> : null}
      </section> : null}
      {status?.has_update && status.available ? <section class="detail-section">
        <strong>可用版本 v{status.available.version}</strong>
        <pre class="firmware-notes">{status.available.release_notes || "此版本未提供更新说明。"}</pre>
        <button type="button" class="chip" disabled={!idle || busy || loading || disconnected || !!status.warning}
          onClick={() => setConfirm({ action: "update", ...status.available! })}>立即更新</button>
      </section> : status?.checked_at && !status.warning && !busy && !disconnected ? <p>已是最新版本</p> : null}
      {!idle && !busy ? <p class="panel-note">设备连接正常且录制、封存结束后才可更新。</p> : null}
      {status?.previous ? <section class="detail-section">
        <strong>版本回退</strong>
        <p>上一版本 v{status.previous.version} · {status.previous.commit.slice(0, 12)}</p>
        <button type="button" class="chip" disabled={!idle || busy || loading || disconnected}
          onClick={() => setConfirm({ action: "rollback", ...status.previous! })}>回退上一版本</button>
      </section> : null}
    </div>
      {confirm ? <section class="detail-section firmware-confirm" role="group" aria-label="确认版本操作">
        <p>{confirm.action === "update" ? "确认更新到" : "确认回退到"} v{confirm.version}？服务将自动重启，录制文件保留。</p>
        <div class="chips">
          <button ref={confirmButton} type="button" class="chip" disabled={loading || !idle || busy || disconnected || (confirm.action === "update" && !!status?.warning)} onClick={() => void submit()}>确认{confirm.action === "update" ? "更新" : "回退"}</button>
          <button type="button" class="chip" disabled={loading} onClick={() => setConfirm(null)}>取消</button>
        </div>
      </section> : null}
  </aside>;
}
