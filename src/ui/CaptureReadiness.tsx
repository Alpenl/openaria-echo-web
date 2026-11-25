import { useEffect, useState } from "preact/hooks";
import { DeviceApiError, getCaptureReadiness, type CaptureReadiness } from "../api/client";

export function useCaptureReadiness(connected: boolean) {
  const [status, setStatus] = useState<CaptureReadiness | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setStatus(null); setError("");
    if (!connected) return;
    const controller = new AbortController();
    let stopped = false;
    let supported = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const value = await getCaptureReadiness(controller.signal);
        if (stopped) return;
        supported = true; setStatus(value); setError("");
      } catch (e) {
        if (stopped) return;
        if (!supported && e instanceof DeviceApiError && e.status === 404) {
          setStatus(null); setError(""); return;
        }
        if (supported) {
          const message = "暂时无法确认录制条件，正在重试";
          setError(message);
          setStatus({ schema: "ylx.capture-readiness.v1", allowed: false,
            code: "readiness_unavailable", message,
            storage: { recording: null, system: null, backing: null } });
        }
      }
      if (!stopped) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [connected]);
  return { status, error };
}

export function ReadinessNotice({ status, error, idle }: {
  status: CaptureReadiness | null; error: string; idle: boolean;
}) {
  if (!status) return null;
  const labels = { recording: "录像盘", system: "系统盘", backing: "镜像宿主盘" };
  return <div class="capture-readiness" role="status" aria-label="当前录制条件">
    <span>{error || (idle || status.code === "recovery_pending" ? status.message : "")}</span>
    {Object.entries(status.storage).map(([kind, budget]) => budget &&
      <span key={kind}>
        {labels[kind as keyof typeof labels]}余 {(budget.available_bytes / 1024 ** 3).toFixed(2)} GiB
        {budget.available_bytes < budget.required_bytes &&
          `（至少需要 ${(budget.required_bytes / 1024 ** 3).toFixed(2)} GiB）`}
      </span>)}
  </div>;
}
