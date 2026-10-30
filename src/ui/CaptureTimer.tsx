import { useEffect, useRef, useState } from "preact/hooks";
import { captureTimerApi, DeviceApiError, type CaptureTimerStatus } from "../api/client";
function formatTimer(seconds: number): string {
  const total = Math.ceil(seconds);
  const mins = Math.floor(total / 60);
  return `${mins}:${String(total % 60).padStart(2, "0")}`;
}

export function CaptureTimer({ connected, idle, sessionId }: {
  connected: boolean; idle: boolean; sessionId: string | null;
}) {
  const [status, setStatus] = useState<CaptureTimerStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState("10");
  const [seconds, setSeconds] = useState("0");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const refresh = async () => {
      const current = generation.current;
      try {
        const value = await captureTimerApi.get(controller.signal);
        if (!stopped && current === generation.current) {
          setStatus(value); setUnsupported(false); setError("");
        }
      } catch (e) {
        if (!stopped && current === generation.current) {
          if (e instanceof DeviceApiError && e.status === 404) setUnsupported(true);
          else setError(e instanceof Error ? e.message : "读取定时设置失败");
        }
      } finally {
        if (!stopped) timer = setTimeout(refresh, sessionId ? 1000 : 5000);
      }
    };
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [connected, sessionId]);

  const duration = Number(minutes) * 60 + Number(seconds);
  const valid = /^\d+$/.test(minutes) && /^\d+$/.test(seconds) &&
    Number(seconds) < 60 && Number.isInteger(duration) && duration >= 1 && duration <= 86400;
  const canEdit = connected && idle && !saving;
  const active = status?.active?.session_id === sessionId ? status?.active : null;

  async function save() {
    if (!canEdit || !valid) return;
    generation.current += 1;
    setSaving(true); setSaveError("");
    try {
      const value = await captureTimerApi.set(enabled, duration);
      generation.current += 1;
      setStatus(value);
      dialog.current?.close();
    } catch (e) {
      generation.current += 1;
      setSaveError(`保存失败：${e instanceof Error ? e.message : "请重试"}`);
    } finally { setSaving(false); }
  }

  if (unsupported) return null;
  return <>
    <button type="button" class="capture-timer-trigger" aria-label="定时结束设置"
      disabled={!connected || saving}
      onClick={() => {
        setSaveError("");
        setEnabled(status?.settings.enabled ?? false);
        const value = status?.settings.duration_seconds ?? 600;
        setMinutes(String(Math.floor(value / 60))); setSeconds(String(value % 60));
        dialog.current?.showModal();
      }}>
      {error ? "定时状态待确认" : !status ? "读取定时设置…" : active ? `剩余 ${formatTimer(active.remaining_seconds)}` :
        status?.settings.enabled ? `定时 ${formatTimer(status.settings.duration_seconds)}` : "定时结束：关"}
    </button>
    <dialog ref={dialog} class="capture-timer-dialog" aria-labelledby="capture-timer-title"
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } }}>
      <h2 id="capture-timer-title">定时结束采集</h2>
      <p>由设备自动停止并保存录像，关闭网页后仍然有效。</p>
      <label class="capture-timer-switch"><input type="checkbox" checked={enabled}
        disabled={!canEdit} onChange={(e) => setEnabled(e.currentTarget.checked)} />开启定时结束</label>
      <div class="capture-timer-duration">
        <label>分钟<input aria-label="定时时长（分钟）" type="number" inputMode="numeric"
          min="0" max="1440" step="1" value={minutes} disabled={!canEdit}
          onInput={(e) => setMinutes(e.currentTarget.value)} /></label>
        <label>秒<input aria-label="定时时长（秒）" type="number" inputMode="numeric"
          min="0" max="59" step="1" value={seconds} disabled={!canEdit}
          onInput={(e) => setSeconds(e.currentTarget.value)} /></label>
      </div>
      <p>可设置 1 秒至 24 小时。设置会保留，用于之后每次网页或实体按钮录制。</p>
      {!idle && <p>录制期间不能修改定时，可随时手动结束录制。</p>}
      {!valid && <p role="alert">请输入 1 秒至 24 小时的有效时长。</p>}
      {(saveError || error) && <p role="alert">{saveError || error}</p>}
      <div class="capture-timer-actions">
        <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>关闭</button>
        <button type="button" disabled={!canEdit || !valid} onClick={() => void save()}>
          {saving ? "正在保存…" : "保存设置"}
        </button>
      </div>
    </dialog>
  </>;
}
