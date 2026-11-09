import { useEffect, useRef, useState } from "preact/hooks";
import { DeviceApiError, voiceApi, type VoiceStatus } from "../api/client";

export function VoiceVolume({ connected, idle }: { connected: boolean; idle: boolean }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [volume, setVolume] = useState(100);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const current = generation.current;
      try {
        const value = await voiceApi.get(controller.signal);
        if (!stopped && current === generation.current) {
          setStatus(value); setUnsupported(false);
          if (!dialog.current?.open) setError("");
        }
      } catch (e) {
        if (!stopped && current === generation.current) {
          if (e instanceof DeviceApiError && e.status === 404) setUnsupported(true);
          else if (!dialog.current?.open) setError("提示音状态读取失败，请稍后重试");
        }
      } finally { if (!stopped) timer = setTimeout(refresh, 5000); }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [connected]);
  const canEdit = connected && idle && !saving && status?.enabled === true;
  async function save() {
    if (!canEdit) return;
    generation.current += 1;
    setSaving(true); setError("");
    try {
      const value = await voiceApi.set(volume);
      generation.current += 1;
      setStatus(value); dialog.current?.close();
    } catch (e) {
      generation.current += 1;
      setError(`保存失败：${e instanceof Error ? e.message : "请重试"}`);
    } finally { setSaving(false); }
  }
  if (unsupported || status?.enabled === false) return null;
  return <>
    <button type="button" class="capture-timer-trigger" aria-label="提示音量设置"
      disabled={!connected || !status || saving} onClick={() => {
        setVolume(status?.volume ?? 100); setError(""); dialog.current?.showModal();
      }}>
      {error && !dialog.current?.open ? "提示音状态待确认" : !status ? "读取提示音设置…" :
        status.volume === 0 ? "提示音：静音" : `提示音：${status.volume}%`}
    </button>
    <dialog ref={dialog} class="capture-timer-dialog" aria-labelledby="voice-volume-title"
      onKeyDown={e => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault(); void save();
        }
      }}>
      <h2 id="voice-volume-title">提示音量</h2>
      <p>调节设备的开始录制、保存和故障提示音，不影响麦克风录音音量。</p>
      <label class="voice-volume-control">提示音量：{volume === 0 ? "静音" : `${volume}%`}
        <input aria-label="提示音量" type="range" min="0" max="100" step="1"
          value={volume} disabled={!canEdit}
          onInput={e => setVolume(Number(e.currentTarget.value))} />
      </label>
      <p>0 为静音。保存后用于后续提示音，重启设备仍会保留。</p>
      {!idle && <p>请在录制结束后调整音量。</p>}
      {!connected && <p role="alert">设备已断开，暂时无法保存。</p>}
      {error && <p role="alert">{error}</p>}
      <div class="capture-timer-actions">
        <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>关闭</button>
        <button type="button" disabled={!canEdit} onClick={() => void save()}>
          {saving ? "正在保存…" : "保存音量"}
        </button>
      </div>
    </dialog>
  </>;
}
