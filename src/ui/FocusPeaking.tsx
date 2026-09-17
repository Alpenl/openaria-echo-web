import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { decodePreviewFrame } from "../api/preview";

import PeakingWorker from "./peaking.worker?worker&inline";
import { fitPeakingDimensions, peakingPixels } from "./peaking";

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

function renderPeakingMask(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  threshold: number,
): number {
  if (image.naturalWidth < 3 || image.naturalHeight < 3) {
    clearCanvas(canvas);
    return 0;
  }
  const { width, height } = fitPeakingDimensions(image.naturalWidth, image.naturalHeight);

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return 0;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);
  source.data.set(peakingPixels(source.data, width, height, threshold));
  context.putImageData(source, 0, 0);
  return 0;
}

export function FocusPeakingOverlay({
  frameUrl,
  state,
}: {
  frameUrl: string | null;
  state: AppState;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const fallbackTimeRef = useRef(0);
  const workerDisabledRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelWorkerRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    mountedRef.current = false;
    generationRef.current += 1;
    enabledRef.current = false;
    cancelWorkerRef.current?.();
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  async function renderInWorker(image: HTMLImageElement, threshold: number): Promise<ImageBitmap | null> {
    if (workerDisabledRef.current || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return null;
    const bitmap = await createImageBitmap(image);
    if (!mountedRef.current) { bitmap.close(); return null; }
    try {
      workerRef.current ??= new PeakingWorker();
    } catch {
      bitmap.close();
      workerDisabledRef.current = true;
      return null;
    }
    const worker = workerRef.current;
    return new Promise((resolve) => {
      const failed = () => {
        workerDisabledRef.current = true;
        worker.terminate();
        workerRef.current = null;
        cancelWorkerRef.current = null;
        resolve(null);
      };
      cancelWorkerRef.current = failed;
      worker.onerror = failed;
      worker.onmessage = (event: MessageEvent<{ mask?: ImageBitmap; error?: boolean }>) => {
        cancelWorkerRef.current = null;
        if (event.data.error) failed();
        else resolve(event.data.mask ?? null);
      };
      try { worker.postMessage({ image: bitmap, threshold }, [bitmap]); }
      catch { bitmap.close(); failed(); }
    });
  }
  const enabledRef = useRef(state.focusPeaking.enabled);
  const generationRef = useRef(0);
  const latestUrlRef = useRef<string | null>(null);
  const thresholdRef = useRef(state.focusPeaking.threshold);
  const requestedEnabledRef = useRef(state.focusPeaking.enabled);
  const frameUrlRef = useRef(frameUrl);

  requestedEnabledRef.current = state.focusPeaking.enabled;
  frameUrlRef.current = frameUrl;

  function cancelAndClear(): void {
    generationRef.current += 1;
    enabledRef.current = false;
    latestUrlRef.current = null;
    clearCanvas(canvasRef.current);
  }

  useEffect(() => {
    const followVisibility = () => {
      if (document.hidden) {
        cancelAndClear();
        return;
      }
      const currentFrame = frameUrlRef.current;
      if (requestedEnabledRef.current && currentFrame) {
        queueFrame(currentFrame);
      }
    };
    document.addEventListener("visibilitychange", followVisibility);
    return () => document.removeEventListener("visibilitychange", followVisibility);
  }, []);

  useLayoutEffect(() => {
    thresholdRef.current = state.focusPeaking.threshold;

    if (!state.focusPeaking.enabled || !frameUrl || document.hidden) {
      cancelAndClear();
      return;
    }

    queueFrame(frameUrl);
  }, [frameUrl, state.focusPeaking.enabled, state.focusPeaking.threshold]);

  function queueFrame(url: string): void {
    const generation = generationRef.current;
    enabledRef.current = true;
    latestUrlRef.current = url;
    if (!busyRef.current) {
      void drainLatestFrame(generation);
    }
  }

  async function drainLatestFrame(generation: number): Promise<void> {
    busyRef.current = true;
    try {
      while (enabledRef.current && generation === generationRef.current) {
        const url = latestUrlRef.current;
        if (!url) {
          return;
        }
        latestUrlRef.current = null;

        try {
          const image = await decodePreviewFrame(url);
          if (!enabledRef.current || generation !== generationRef.current) {
            return;
          }
          const mask = await renderInWorker(image, thresholdRef.current);
          try {
            const canvas = canvasRef.current;
            if (!canvas || !enabledRef.current || generation !== generationRef.current) return;
            if (mask) {
              canvas.width = mask.width;
              canvas.height = mask.height;
              canvas.getContext("2d")?.drawImage(mask, 0, 0);
              canvas.dataset.renderer = "worker";
            } else if (performance.now() - fallbackTimeRef.current >= 100) {
              // Older browsers keep a bounded 10 Hz overlay; preview keeps its own cadence.
              fallbackTimeRef.current = performance.now();
              renderPeakingMask(canvas, image, thresholdRef.current);
              canvas.dataset.renderer = "fallback";
            }
          } finally { mask?.close(); }
        } catch {
          if (generation === generationRef.current) {
            clearCanvas(canvasRef.current);
          }
        }
      }
    } finally {
      busyRef.current = false;
      if (enabledRef.current && latestUrlRef.current) {
        void drainLatestFrame(generationRef.current);
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      class="focus-peaking-canvas"
      data-testid="focus-peaking-canvas"
      hidden={!state.focusPeaking.enabled || !frameUrl}
      aria-hidden="true"
    />
  );
}

export function FocusPeakingControl({ state }: { state: AppState }) {
  return (
    <div class="focus-peaking-control" data-enabled={String(state.focusPeaking.enabled)}>
      <button
        type="button"
        role="switch"
        aria-label="峰值对焦"
        aria-checked={state.focusPeaking.enabled}
        title="峰值对焦"
        onClick={() => store.dispatch({ type: "focus-peaking.toggled" })}
      >
        PEAK
      </button>
      <input
        type="range"
        min="0"
        max="255"
        step="1"
        value={state.focusPeaking.threshold}
        disabled={!state.focusPeaking.enabled}
        aria-label="峰值对焦阈值"
        onInput={(event) =>
          store.dispatch({
            type: "focus-peaking.threshold",
            threshold: Number((event.currentTarget as HTMLInputElement).value),
          })
        }
      />
      <output aria-hidden="true">{state.focusPeaking.threshold}</output>
    </div>
  );
}
