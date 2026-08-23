import {
  API_ROOT,
  DeviceApiError,
  makeApiError,
  requestHeaders,
  waitForAbortableDelay,
} from "./client";
import type { CaptureEvent, NetworkEvent } from "./types";

const CAPTURE_EVENT_URL = `${API_ROOT}/capture/events`;
const NETWORK_EVENT_URL = `${API_ROOT}/network/events`;

interface SsePayloadIdentity {
  schema?: string;
  sse_delivery_id?: string;
  type?: string;
}

/**
 * SSE delivery identity 只是传输身份，不是权威修订号。envelope 与 payload
 * 三处（id / event / schema）必须逐字一致，否则这一帧不可信，直接抛错重连。
 */
function parseEvent<T extends SsePayloadIdentity>(
  block: string,
  expectedSchema: string,
  mismatchMessage: string,
): { id: string; payload: T } | null {
  let id: string | null = null;
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "id") {
      id = value;
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  if (!id || data.length === 0) {
    return null;
  }
  const payload = JSON.parse(data.join("\n")) as SsePayloadIdentity | null;
  if (
    !payload ||
    payload.schema !== expectedSchema ||
    payload.sse_delivery_id !== id ||
    payload.type !== event
  ) {
    throw new Error(mismatchMessage);
  }
  return { id, payload: payload as T };
}

export interface FollowCaptureEventsOptions {
  signal: AbortSignal;
  onEvent: (event: CaptureEvent) => Promise<void> | void;
  onConnection: (state: "connected" | "disconnected") => void;
  onUnauthorized: (error: DeviceApiError) => void;
}

export interface FollowNetworkEventsOptions {
  signal: AbortSignal;
  onEvent: (event: NetworkEvent) => Promise<void> | void;
  onUnauthorized: (error: DeviceApiError) => void;
}

interface FollowEventsOptions<T extends SsePayloadIdentity> {
  signal: AbortSignal;
  onEvent: (event: T) => Promise<void> | void;
  onConnection?: (state: "connected" | "disconnected") => void;
  onUnauthorized: (error: DeviceApiError) => void;
}

async function followEvents<T extends SsePayloadIdentity>(
  eventUrl: string,
  expectedSchema: string,
  mismatchMessage: string,
  options: FollowEventsOptions<T>,
): Promise<void> {
  let lastEventId: string | null = null;
  while (!options.signal.aborted) {
    try {
      const headers = requestHeaders("text/event-stream");
      if (lastEventId) {
        headers.set("Last-Event-ID", lastEventId);
      }
      const response = await fetch(eventUrl, {
        cache: "no-store",
        headers,
        signal: options.signal,
      });
      if (!response.ok) {
        throw await makeApiError(response);
      }
      if (!response.body) {
        throw new Error("设备事件流没有响应正文");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let connected = false;
      while (!options.signal.aborted) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
          buffer = buffer.slice(boundary + separator.length);
          const parsed = parseEvent<T>(block, expectedSchema, mismatchMessage);
          if (parsed) {
            await options.onEvent(parsed.payload);
            lastEventId = parsed.id;
            if (!connected) {
              options.onConnection?.("connected");
              connected = true;
            }
          }
          boundary = buffer.search(/\r?\n\r?\n/);
        }
        if (done) {
          break;
        }
      }
    } catch (error) {
      if (options.signal.aborted) {
        return;
      }
      if (error instanceof DeviceApiError && error.status === 401) {
        options.onConnection?.("disconnected");
        options.onUnauthorized(error);
        return;
      }
      console.warn(error);
    }
    options.onConnection?.("disconnected");
    await waitForAbortableDelay(1000, options.signal);
  }
}

export async function followCaptureEvents(options: FollowCaptureEventsOptions): Promise<void> {
  await followEvents<CaptureEvent>(
    CAPTURE_EVENT_URL,
    "ylx.capture-event.v4",
    "设备事件与 SSE envelope 不一致",
    options,
  );
}

export async function followNetworkEvents(options: FollowNetworkEventsOptions): Promise<void> {
  await followEvents<NetworkEvent>(
    NETWORK_EVENT_URL,
    "ylx.network-event.v1",
    "网络事件与 SSE envelope 不一致",
    options,
  );
}
