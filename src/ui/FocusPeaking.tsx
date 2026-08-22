import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";

const PEAK_COLOR = [232, 88, 255, 230] as const;

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

async function decodeFrame(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

function renderPeakingMask(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  threshold: number,
): number {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width < 3 || height < 3) {
    clearCanvas(canvas);
    return 0;
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return 0;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);
  const output = context.createImageData(width, height);
  const luminance = new Uint8Array(width * height);

  for (let index = 0, pixel = 0; index < source.data.length; index += 4, pixel += 1) {
    luminance[pixel] =
      (source.data[index] ?? 0) * 0.299 +
      (source.data[index + 1] ?? 0) * 0.587 +
      (source.data[index + 2] ?? 0) * 0.114;
  }

  let highlighted = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      const horizontal = Math.abs((luminance[pixel - 1] ?? 0) - (luminance[pixel + 1] ?? 0));
      const vertical = Math.abs((luminance[pixel - width] ?? 0) - (luminance[pixel + width] ?? 0));
      if (Math.max(horizontal, vertical) > threshold) {
        const outputIndex = pixel * 4;
        output.data[outputIndex] = PEAK_COLOR[0];
        output.data[outputIndex + 1] = PEAK_COLOR[1];
        output.data[outputIndex + 2] = PEAK_COLOR[2];
        output.data[outputIndex + 3] = PEAK_COLOR[3];
        highlighted += 1;
      }
    }
  }

  context.putImageData(output, 0, 0);
  return highlighted;
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
    const generation = generationRef.current + 1;
    generationRef.current = generation;
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
          const image = await decodeFrame(url);
          if (!enabledRef.current || generation !== generationRef.current) {
            return;
          }
          if (canvasRef.current) {
            renderPeakingMask(canvasRef.current, image, thresholdRef.current);
          }
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
