import { useEffect, useRef, useState } from "preact/hooks";
import { clockFeedback, deviceApi } from "../api/client";

export function ClockStatus({ connected, idle }: { connected: boolean; idle: boolean }) {
  const [view, setView] = useState(clockFeedback.current);
  const [tick, setTick] = useState(performance.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => clockFeedback.subscribe(setView), []);
  useEffect(() => {
    const timer = setInterval(() => setTick(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const status = view.status;
  const ready = !!status && status.source !== "unsynchronized" && !view.error;
  const current = status ? status.unix_time_ms + Math.max(0, tick - view.observedAt) : null;
  const difference = current === null ? 0 : Math.abs(current - Date.now());
  const format = (ms: number) => new Date(ms).toLocaleString("zh-CN", { hour12: false });
  const discrepancy = ready && difference > 60_000;
  const canEdit = connected && idle && !view.pending;
  async function sync(replace = false) {
    setConfirm(false);
    try { await (replace ? deviceApi.resyncClock() : deviceApi.syncClock()); } catch { /* shown by feedback */ }
  }
  if (!status && !view.error && !view.pending) return null;
  return <div class="device-clock">
    <button type="button" class="capture-timer-trigger" data-testid="clock-status"
      disabled={!connected} onClick={() => { setConfirm(false); dialog.current?.showModal(); }}>
      {!connected ? "设备时间待确认" : view.error ? "校时失败 · 点击重试" :
        !ready ? "尚未校时" : discrepancy ? "时间与手机不一致" : "时间已校准"}
      {connected && ready && current !== null && <span> · {format(current)}</span>}
    </button>
    <dialog ref={dialog} class="capture-timer-dialog" aria-labelledby="clock-title">
      <h2 id="clock-title">设备时间</h2>
      <p>设备时间：{current === null ? "尚未读取" : format(current)}</p>
      <p>手机／电脑时间：{format(Date.now())}</p>
      <p>日期按本机时区显示（{Intl.DateTimeFormat().resolvedOptions().timeZone}）。</p>
      <p>{ready ? (status?.source === "ntp" ? "设备时间来自网络校时。" : "已通过手机或电脑校准。") :
        "请保持页面打开完成校时，成功后可断开手机独立录制。"}</p>
      {status?.synchronized_at_ms != null && <p>最近校时：{format(status.synchronized_at_ms)}</p>}
      {discrepancy && <p role="alert">设备与当前手机时间相差超过一分钟，请先确认手机日期正确。</p>}
      {!connected && <p role="alert">设备已断开，显示的是上次读取的时间。</p>}
      {!idle && <p>录制或保存期间不能校时，请结束后操作。</p>}
      {view.error && <p role="alert">{view.error}</p>}
      {confirm && <p>确定使用当前手机／电脑的时间？仅影响之后的新录像，已有录像日期保持不变。</p>}
      <div class="capture-timer-actions">
        <button type="button" onClick={() => dialog.current?.close()}>关闭</button>
        {!ready && <button type="button" disabled={!canEdit} onClick={() => void sync()}>重新校时</button>}
        {ready && status?.schema === "ylx.clock-status.v2" && status.source !== "ntp" &&
          <button type="button" disabled={!canEdit} onClick={() => confirm ? void sync(true) : setConfirm(true)}>
            {confirm ? "确认使用当前手机时间" : "使用这台手机时间重新校准"}
          </button>}
      </div>
    </dialog>
  </div>;
}
