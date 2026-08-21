import { DeviceApiError, getLatestPreview, waitForAbortableDelay } from "./client";

export type PreviewState = "live" | "waiting" | "unavailable";

export interface FollowLatestPreviewOptions {
  signal: AbortSignal;
  onFrame: (objectUrl: string) => void;
  onState: (state: PreviewState) => void;
}

/**
 * 单槽覆盖：任何时刻只保留最新一帧的 object URL，旧帧立刻回收。
 * 慢客户端丢弃旧帧，永远不向采集路径施加背压，也不累积陈旧画面。
 */
export async function followLatestPreview(options: FollowLatestPreviewOptions): Promise<void> {
  let currentUrl: string | null = null;
  try {
    while (!options.signal.aborted) {
      try {
        const blob = await getLatestPreview(options.signal);
        const nextUrl = URL.createObjectURL(blob);
        options.onFrame(nextUrl);
        options.onState("live");
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        currentUrl = nextUrl;
        await waitForAbortableDelay(40, options.signal);
      } catch (error) {
        if (options.signal.aborted) {
          return;
        }
        const expectedIdle =
          error instanceof DeviceApiError &&
          error.status === 503 &&
          error.code === "preview_unavailable";
        options.onState(expectedIdle ? "waiting" : "unavailable");
        if (!expectedIdle) {
          console.warn(error);
        }
        await waitForAbortableDelay(500, options.signal);
      }
    }
  } finally {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
    }
  }
}
