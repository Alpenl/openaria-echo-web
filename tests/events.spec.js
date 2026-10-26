// @ts-check
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { followCaptureEvents, followNetworkEvents } from "../src/api/events.ts";

const eventFixture = JSON.parse(
  readFileSync(new URL("./fixtures/capture-event.json", import.meta.url), "utf8"),
);

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve: (value = undefined) => resolve(value) };
}

function eventBlock(id, overrides = {}) {
  return `id: ${id}\nevent: diagnostic\ndata: ${JSON.stringify({
    ...eventFixture, sse_delivery_id: id, ...overrides,
  })}\n\n`;
}

function trackedStream(payload = "", { closed = false, cancel = () => {} } = {}) {
  let controller;
  const calls = { cancel: 0, release: 0, sourceCancel: 0 };
  const reading = deferred();
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      if (payload) value.enqueue(new TextEncoder().encode(payload));
      if (closed) value.close();
    },
    cancel() {
      calls.sourceCancel++;
      return cancel();
    },
  });
  const getReader = stream.getReader.bind(stream);
  stream.getReader = () => {
    const reader = getReader();
    const originalRead = reader.read.bind(reader);
    const originalCancel = reader.cancel.bind(reader);
    const originalRelease = reader.releaseLock.bind(reader);
    reader.read = () => {
      reading.resolve();
      return originalRead();
    };
    reader.cancel = (reason) => {
      calls.cancel++;
      return originalCancel(reason);
    };
    reader.releaseLock = () => {
      calls.release++;
      originalRelease();
    };
    return reader;
  };
  return { stream, calls, reading: reading.promise, controller: () => controller };
}

let originalFetch;
let originalWindow;
let originalWarn;
let delays;
test.beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  originalWarn = console.warn;
  delays = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (callback, milliseconds) => {
        delays.push(milliseconds);
        return setTimeout(callback, 0);
      },
      clearTimeout,
    },
  });
  console.warn = () => {};
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

for (const fault of ["malformed JSON", "envelope mismatch", "callback rejection"]) {
  test(`SSE cancels and unlocks before retrying ${fault}`, async () => {
    const abort = new AbortController();
    const cancelStarted = deferred();
    const releaseCancel = deferred();
    const reconnected = deferred();
    const faulty = fault === "malformed JSON"
      ? "id: 2\nevent: diagnostic\ndata: {\n\n"
      : eventBlock("2", fault === "envelope mismatch" ? { sse_delivery_id: "wrong" } : {});
    const body = trackedStream(eventBlock("1") + faulty, {
      cancel: () => { cancelStarted.resolve("cancel"); return releaseCancel.promise; },
    });
    const requests = [];
    const received = [];
    const connections = [];
    let cleanBeforeReconnect = false;
    globalThis.fetch = async (_url, options) => {
      requests.push(new Headers(options?.headers).get("Last-Event-ID"));
      if (requests.length === 1) return new Response(body.stream);
      cleanBeforeReconnect = !body.stream.locked && body.calls.release === 1;
      reconnected.resolve("reconnect");
      abort.abort();
      return new Response("");
    };
    const following = followCaptureEvents({
      signal: abort.signal,
      onEvent: async (event) => {
        if (event.sse_delivery_id === "2") throw new Error("application rejected event");
        received.push(event.sse_delivery_id);
      },
      onConnection: (state) => connections.push(state),
      onUnauthorized: () => { throw new Error("unexpected authorization error"); },
    });
    try {
      expect(await Promise.race([cancelStarted.promise, reconnected.promise])).toBe("cancel");
      expect(requests).toEqual([null]);
      expect(body.stream.locked).toBe(true);
      releaseCancel.resolve();
      await following;
      expect(body.calls).toEqual({ cancel: 1, sourceCancel: 1, release: 1 });
      expect(cleanBeforeReconnect).toBe(true);
      expect(requests).toEqual([null, "1"]);
      expect(received).toEqual(["1"]);
      expect(connections.slice(0, 2)).toEqual(["connected", "connecting"]);
      expect(delays).toEqual([1000]);
    } finally {
      abort.abort();
      releaseCancel.resolve();
      await following;
    }
  });
}

test("SSE releases a normally ended reader before reconnecting from its last event", async () => {
  const abort = new AbortController();
  const body = trackedStream(eventBlock("1"), { closed: true });
  const requests = [];
  let cleanBeforeReconnect = false;
  globalThis.fetch = async (_url, options) => {
    requests.push(new Headers(options?.headers).get("Last-Event-ID"));
    if (requests.length === 1) return new Response(body.stream);
    cleanBeforeReconnect = !body.stream.locked && body.calls.release === 1;
    abort.abort();
    return new Response("");
  };
  await followCaptureEvents({
    signal: abort.signal, onEvent: () => {}, onConnection: () => {}, onUnauthorized: () => {},
  });
  expect(cleanBeforeReconnect).toBe(true);
  expect(body.calls).toEqual({ cancel: 1, sourceCancel: 0, release: 1 });
  expect(requests).toEqual([null, "1"]);
});

for (const [name, follow] of [["capture", followCaptureEvents], ["network", followNetworkEvents]]) {
  test(`${name} SSE abort unlocks an errored pending fetch reader without reconnecting`, async () => {
    const abort = new AbortController();
    const body = trackedStream();
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      requests++;
      // Native fetch abort errors its response body and rejects an outstanding read.
      options.signal.addEventListener("abort", () => {
        body.controller().error(new DOMException("aborted", "AbortError"));
      }, { once: true });
      return new Response(body.stream);
    };
    const following = follow({
      signal: abort.signal, onEvent: () => {}, onConnection: () => {}, onUnauthorized: () => {},
    });
    await body.reading;
    abort.abort();
    await following;
    expect(requests).toBe(1);
    expect(body.stream.locked).toBe(false);
    expect(body.calls).toEqual({ cancel: 1, sourceCancel: 0, release: 1 });
    expect(delays).toEqual([]);
  });
}

test("SSE cancellation failure still releases the lock and retries", async () => {
  const abort = new AbortController();
  const body = trackedStream("id: 1\nevent: diagnostic\ndata: {\n\n", {
    cancel: () => Promise.reject(new Error("transport already failed")),
  });
  let requests = 0;
  let cleanBeforeReconnect = false;
  globalThis.fetch = async () => {
    requests++;
    if (requests === 1) return new Response(body.stream);
    cleanBeforeReconnect = !body.stream.locked && body.calls.release === 1;
    abort.abort();
    return new Response("");
  };
  await followCaptureEvents({
    signal: abort.signal, onEvent: () => {}, onConnection: () => {}, onUnauthorized: () => {},
  });
  expect(requests).toBe(2);
  expect(cleanBeforeReconnect).toBe(true);
  expect(body.calls).toEqual({ cancel: 1, sourceCancel: 1, release: 1 });
});
