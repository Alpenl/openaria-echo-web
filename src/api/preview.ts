import { DeviceApiError, getLatestPreview, waitForAbortableDelay } from "./client";

export type PreviewState = "waiting" | "live" | "unavailable" | "disconnected";

export interface FollowLatestPreviewOptions {
  signal: AbortSignal;
  onFrame: (objectUrl: string | null) => void;
  onState: (state: PreviewState) => void;
}

// Preview and focus peaking share decoded images. Keep only the displayed,
// retired and at most two incoming frames, never a history of full images.
export type PreviewImage = ImageBitmap | HTMLImageElement;
export function previewDimensions(image: PreviewImage): { width: number; height: number } {
  return image instanceof HTMLImageElement
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}
const decodedFrames = new Map<string, Promise<PreviewImage>>();
function releaseDecodedFrame(url: string): void {
  const decoded = decodedFrames.get(url);
  decodedFrames.delete(url);
  void decoded?.then((image) => { if ("close" in image) image.close(); }).catch(() => {});
}
export function decodePreviewFrame(url: string, blob?: Blob): Promise<PreviewImage> {
  const existing = decodedFrames.get(url);
  if (existing) return existing;
  const decodeImage = async (): Promise<HTMLImageElement> => {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  };
  // Bitmap decoding avoids the full-size <img> decode scheduling delay and
  // shares native pixels with the canvas and focus worker, without re-encoding.
  const decoded = typeof createImageBitmap === "function"
    ? (blob ? Promise.resolve(blob) : fetch(url).then((response) => response.blob()))
      .then((source) => createImageBitmap(source)).catch(decodeImage)
    : decodeImage();
  decodedFrames.set(url, decoded);
  while (decodedFrames.size > 4) releaseDecodedFrame(decodedFrames.keys().next().value!);
  return decoded;
}

/**
 * Keep one network request and at most two decodes in flight. Native stereo
 * images can take longer to decode than one frame period; overlap that work
 * without building a queue. Only newer decoded frames may replace the image.
 * Keep the displayed URL alive until its replacement has been painted.
 */
export async function followLatestPreview(options: FollowLatestPreviewOptions): Promise<void> {
  let currentUrl: string | null = null;
  let retiredUrl: string | null = null;
  let sequence = 0;
  let published = 0;
  let stopped = false;
  let decodeFailure: unknown = null;
  const pending = new Set<Promise<void>>();
  const release = (url: string) => {
    URL.revokeObjectURL(url);
    releaseDecodedFrame(url);
  };
  let paintHandle: number | null = null;
  let readyFrame: { url: string; sequence: number; done: () => void } | null = null;
  const discardReady = () => {
    if (paintHandle !== null) cancelAnimationFrame(paintHandle);
    paintHandle = null;
    if (readyFrame) {
      release(readyFrame.url);
      readyFrame.done();
      readyFrame = null;
    }
  };
  const queueFrame = (url: string, frameSequence: number): Promise<void> => {
    if (stopped || options.signal.aborted || frameSequence <= published ||
        (readyFrame && frameSequence < readyFrame.sequence)) {
      release(url);
      return Promise.resolve();
    }
    if (readyFrame) {
      release(readyFrame.url);
      readyFrame.done();
    }
    return new Promise((done) => {
      readyFrame = { url, sequence: frameSequence, done };
      // Publish at most once per paint. Two decodes can finish together;
      // revoking twice before Preact commits would invalidate the visible URL.
      paintHandle ??= requestAnimationFrame(() => {
        paintHandle = null;
        const frame = readyFrame!;
        readyFrame = null;
        if (stopped || options.signal.aborted || frame.sequence <= published) {
          release(frame.url);
        } else {
          if (retiredUrl) release(retiredUrl);
          retiredUrl = currentUrl;
          currentUrl = frame.url;
          published = frame.sequence;
          options.onFrame(frame.url);
          options.onState("live");
        }
        frame.done();
      });
    });
  };
  const clearFrame = () => {
    if (retiredUrl) {
      release(retiredUrl);
      retiredUrl = null;
    }
    if (currentUrl) {
      release(currentUrl);
      currentUrl = null;
    }
    options.onFrame(null);
    decodedFrames.clear();
  };
  options.signal.addEventListener("abort", discardReady, { once: true });
  try {
    while (!options.signal.aborted) {
      try {
        if (pending.size >= 2) await Promise.race(pending);
        if (options.signal.aborted) return;
        if (decodeFailure) {
          const error = decodeFailure;
          decodeFailure = null;
          throw error;
        }
        const started = performance.now();
        const blob = await getLatestPreview(options.signal);
        const nextUrl = URL.createObjectURL(blob);
        const nextSequence = ++sequence;
        const task = decodePreviewFrame(nextUrl, blob).then(() => queueFrame(nextUrl, nextSequence)).catch((error: unknown) => {
          release(nextUrl);
          if (nextSequence > published) decodeFailure = error;
        }).finally(() => { pending.delete(task); });
        pending.add(task);
        await waitForAbortableDelay(Math.max(0, 1000 / 30 - (performance.now() - started)), options.signal);
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
          // Results already being decoded belong to the disconnected camera.
          published = sequence;
          discardReady();
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
    stopped = true;
    discardReady();
    await Promise.all(pending);
    options.signal.removeEventListener("abort", discardReady);
    clearFrame();
  }
}
