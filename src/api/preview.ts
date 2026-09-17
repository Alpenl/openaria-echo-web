import { DeviceApiError, getLatestPreview, waitForAbortableDelay } from "./client";

export type PreviewState = "waiting" | "live" | "unavailable" | "disconnected";

export interface FollowLatestPreviewOptions {
  signal: AbortSignal;
  onFrame: (objectUrl: string | null) => void;
  onState: (state: PreviewState) => void;
}

// Preview and focus peaking share the same decoded image. The two-entry cache
// holds only the displayed and incoming frame, never a history of full images.
const decodedFrames = new Map<string, Promise<HTMLImageElement>>();
export function decodePreviewFrame(url: string): Promise<HTMLImageElement> {
  const existing = decodedFrames.get(url);
  if (existing) return existing;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  const decoded = image.decode().then(() => image);
  decodedFrames.set(url, decoded);
  while (decodedFrames.size > 2) decodedFrames.delete(decodedFrames.keys().next().value!);
  return decoded;
}

/**
 * Fetch and decode one frame at a time. Keep the displayed URL alive until a
 * decoded replacement has been committed and the browser has painted it.
 */
export async function followLatestPreview(options: FollowLatestPreviewOptions): Promise<void> {
  let currentUrl: string | null = null;
  let retiredUrl: string | null = null;
  const clearFrame = () => {
    if (retiredUrl) {
      URL.revokeObjectURL(retiredUrl);
      retiredUrl = null;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    options.onFrame(null);
    decodedFrames.clear();
  };
  try {
    while (!options.signal.aborted) {
      try {
        const blob = await getLatestPreview(options.signal);
        const nextUrl = URL.createObjectURL(blob);
        try {
          await decodePreviewFrame(nextUrl);
          if (options.signal.aborted) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
        } catch (error) {
          URL.revokeObjectURL(nextUrl);
          throw error;
        }
        // Preact commits state asynchronously. Revoking currentUrl here can
        // invalidate the still-visible <img>, particularly on mobile WebKit.
        if (retiredUrl) URL.revokeObjectURL(retiredUrl);
        retiredUrl = currentUrl;
        currentUrl = nextUrl;
        options.onFrame(nextUrl);
        options.onState("live");
        await waitForAbortableDelay(40, options.signal);
      } catch (error) {
        if (options.signal.aborted) {
          return;
        }
        // 空闲时没有可用帧是正常的：界面照说「画面暂不可用」，但不往控制台刷噪音。
        const expectedIdle =
          error instanceof DeviceApiError &&
          error.status === 503 &&
          error.code === "preview_unavailable";
        const cameraDisconnected =
          error instanceof DeviceApiError &&
          error.status === 503 &&
          error.code === "camera_not_connected";
        if (cameraDisconnected) {
          clearFrame();
          options.onState("disconnected");
        } else {
          options.onState("unavailable");
        }
        if (!expectedIdle && !cameraDisconnected) {
          console.warn(error);
        }
        await waitForAbortableDelay(500, options.signal);
      }
    }
  } finally {
    clearFrame();
  }
}
