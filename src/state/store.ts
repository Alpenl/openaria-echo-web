import { DeviceApiError, deviceApi } from "../api/client";
import type {
  CaptureEvent,
  CaptureStateEventPayload,
  CaptureStatus,
  SafeSwapReceipt,
  SessionList,
} from "../api/types";
import {
  initialState,
  reduceState,
  shouldAnnounceRetainedDiagnostics,
  type Action,
  type AppState,
  type NetworkDraft,
  type SessionFilter,
  type VisibleError,
} from "./reducer";

const SESSION_PAGE_SIZE = 25;
const TERMINAL_CAPTURE_RETRY_DELAYS_MS = [120, 240] as const;
const SEALED_SESSION_RETRY_DELAYS_MS = [120, 240] as const;
const CAPTURE_STATE_EVENT_KEYS = new Set(["schema", "state", "volume_id", "generation_id"]);
const CAPTURE_STATE_EVENT_STATES = new Set<CaptureStateEventPayload["state"]>([
  "recording",
  "finalizing",
  "encoding",
  "verifying",
  "recoverable",
  "failed",
  "abandoned",
]);
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function sealedTerminalSessionId(
  previous: CaptureStatus | null,
  next: CaptureStatus | null,
): string | null {
  const active = previous?.snapshot.active_recording;
  if (
    !active ||
    !next ||
    previous.authority_epoch !== next.authority_epoch ||
    next.snapshot.device_state !== "idle" ||
    next.snapshot.active_recording ||
    next.snapshot.retained_unsuccessful
  ) {
    return null;
  }
  return active.recording_state.session_id;
}

function isCaptureStateEventState(value: unknown): value is CaptureStateEventPayload["state"] {
  return (
    typeof value === "string" &&
    CAPTURE_STATE_EVENT_STATES.has(value as CaptureStateEventPayload["state"])
  );
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function isCaptureStateEventPayload(data: unknown): data is CaptureStateEventPayload {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const payload = data as Record<string, unknown>;
  const keys = Object.keys(payload);
  return (
    keys.length === CAPTURE_STATE_EVENT_KEYS.size &&
    keys.every((key) => CAPTURE_STATE_EVENT_KEYS.has(key)) &&
    payload.schema === "ylx.capture-state-event.v2" &&
    isCaptureStateEventState(payload.state) &&
    isUuidV4(payload.volume_id) &&
    isUuidV4(payload.generation_id)
  );
}

export function visibleError(error: unknown): VisibleError {
  if (error instanceof DeviceApiError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return {
    code: "command_failed",
    message: error instanceof Error ? error.message : "命令失败",
  };
}

/**
 * 浏览器状态永远不是恢复依据：这个 store 只投影 daemon 的权威快照，
 * 从不产生本地乐观状态，也从不在命令返回前抢先改状态机。
 */
export class EchoStore {
  private state: AppState = initialState;
  private readonly listeners = new Set<() => void>();

  private captureRefresh: Promise<void> | null = null;
  private relatedRefresh: Promise<void> | null = null;
  private sessionsRefresh: Promise<void> | null = null;
  private sessionsRefreshDirty = false;

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (action: Action): void => {
    const previous = this.state;
    this.state = reduceState(this.state, action);
    if (
      action.type === "capture.snapshot" &&
      shouldAnnounceRetainedDiagnostics(previous, action.payload)
    ) {
      const retained = action.payload.snapshot.retained_unsuccessful?.recording_state.diagnostics;
      if (retained?.length) {
        const existing = new Set(
          this.state.diagnostics.map((diagnostic) => `${diagnostic.code}|${diagnostic.at}`),
        );
        for (const diagnostic of retained) {
          if (!existing.has(`${diagnostic.code}|${diagnostic.at}`)) {
            this.state = reduceState(this.state, { type: "diagnostic.received", payload: diagnostic });
          }
        }
      }
    }
    if (this.state !== previous) {
      for (const listener of this.listeners) {
        listener();
      }
    }
  };

  async loadInitialState(): Promise<boolean> {
    try {
      const device = await deviceApi.getDevice();
      const capture = await deviceApi.getCaptureStatus();
      this.dispatch({ type: "device.loaded", payload: device });
      this.dispatch({ type: "capture.snapshot", payload: capture });
      this.dispatch({ type: "error.cleared" });
      this.dispatch({ type: "credentials.cleared" });

      // 会话清单在大卷上要做完整 manifest 校验；它和维护资源都不能阻塞
      // 权威状态、SSE 或预览，否则设备在线时界面仍会长时间显示未连接。
      void deviceApi
        .getSafeSwap()
        .then((safeSwap) => {
          if (safeSwap?.schema === "ylx.safe-swap-receipt-resource.v3") {
            this.acceptSafeSwapReceipt(
              safeSwap.receipt,
              capture.authority_epoch,
              capture.source_revision,
            );
          } else {
            this.dispatch({ type: "safe-swap.cleared" });
          }
        })
        .catch((error) => console.warn(error));
      if (device.capabilities.network_mutation) {
        void deviceApi
          .getNetwork()
          .then((network) => this.dispatch({ type: "network.loaded", payload: network }))
          .catch((error) => console.warn(error));
      } else {
        this.dispatch({ type: "network.loaded", payload: null });
      }
      void this.refreshSessions();
      return true;
    } catch (error) {
      if (error instanceof DeviceApiError && error.status === 401) {
        this.dispatch({ type: "credentials.required" });
      }
      this.dispatch({
        type: "connection.failed",
        error:
          error instanceof DeviceApiError
            ? visibleError(error)
            : { code: "connection_failed", message: "连接失败" },
      });
      return false;
    }
  }

  /**
   * 七项一致才接受回执：schema、当前权威、当前修订、当前卷、指定 session、
   * generation/session/volume 身份、release_state，外加 open_handle_count = 0。
   */
  acceptSafeSwapReceipt(
    receipt: unknown,
    authorityEpoch: string,
    sourceRevision: number,
    subjectSessionId: string | null = null,
  ): boolean {
    const candidate = receipt as SafeSwapReceipt | null;
    const current = this.state.capture;
    const recording = current?.snapshot.active_recording ?? current?.snapshot.retained_unsuccessful;
    const identitiesMatch =
      !recording ||
      (recording.generation_id === candidate?.generation_id &&
        recording.recording_state.session_id === candidate?.session_id &&
        recording.recording_state.storage.volume_id === candidate?.volume_id);
    const isReleased =
      candidate?.release_state === "unmounted" || candidate?.release_state === "device-released";
    if (
      candidate?.schema !== "ylx.safe-swap-receipt.v3" ||
      !current ||
      current.authority_epoch !== authorityEpoch ||
      current.source_revision !== sourceRevision ||
      this.state.device?.storage.volume_id !== candidate.volume_id ||
      (subjectSessionId !== null && subjectSessionId !== candidate.session_id) ||
      !identitiesMatch ||
      !isReleased ||
      candidate.open_handle_count !== 0
    ) {
      return false;
    }
    this.dispatch({
      type: "safe-swap.received",
      payload: { receipt: candidate, authorityEpoch, sourceRevision },
    });
    return true;
  }

  refreshCapture = async (): Promise<void> => {
    if (!this.captureRefresh) {
      this.captureRefresh = deviceApi
        .getCaptureStatus()
        .then((capture) => this.dispatch({ type: "capture.snapshot", payload: capture }))
        .finally(() => {
          this.captureRefresh = null;
        });
    }
    await this.captureRefresh;
  };

  refreshRelatedResources = async (): Promise<void> => {
    if (!this.relatedRefresh) {
      this.relatedRefresh = Promise.all([deviceApi.getDevice(), deviceApi.getSafeSwap()])
        .then(([device, safeSwap]) => {
          this.dispatch({ type: "device.loaded", payload: device });
          if (safeSwap?.schema === "ylx.safe-swap-receipt-resource.v3" && this.state.capture) {
            this.acceptSafeSwapReceipt(
              safeSwap.receipt,
              this.state.capture.authority_epoch,
              this.state.capture.source_revision,
            );
          } else {
            this.dispatch({ type: "safe-swap.cleared" });
          }
        })
        .catch((error) => console.warn(error))
        .finally(() => {
          this.relatedRefresh = null;
        });
      void this.refreshSessions();
    }
    await this.relatedRefresh;
  };

  private async listSessions(cursor: string | null): Promise<SessionList> {
    try {
      return await deviceApi.listSessions({ limit: SESSION_PAGE_SIZE, cursor });
    } catch (error) {
      if (
        error instanceof DeviceApiError &&
        error.status === 409 &&
        error.code === "volume_not_mounted"
      ) {
        return { items: [], diagnostics: [], next_cursor: null };
      }
      throw error;
    }
  }

  refreshSessions = async (): Promise<void> => {
    if (this.sessionsRefresh) {
      this.sessionsRefreshDirty = true;
      await this.sessionsRefresh;
      if (this.sessionsRefreshDirty) {
        await this.refreshSessions();
      }
      return;
    }

    this.sessionsRefresh = this.runSessionsRefreshLoop();
    await this.sessionsRefresh;
  };

  private async runSessionsRefreshLoop(): Promise<void> {
    try {
      do {
        this.sessionsRefreshDirty = false;
        this.dispatch({ type: "sessions.pending" });
        try {
          const sessions = await this.listSessions(null);
          this.dispatch({ type: "sessions.loaded", payload: sessions, append: false });
        } catch (error) {
          console.warn(error);
          this.dispatch({ type: "sessions.failed" });
        }
      } while (this.sessionsRefreshDirty);
    } finally {
      this.sessionsRefresh = null;
    }
  }

  private async refreshSessionsUntilVisible(sessionId: string): Promise<void> {
    for (let attempt = 0; attempt <= SEALED_SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
      await this.refreshSessions();
      if (this.state.sessions.items.some((session) => session.session_id === sessionId)) {
        return;
      }
      const retryDelay = SEALED_SESSION_RETRY_DELAYS_MS[attempt];
      if (retryDelay !== undefined) {
        await wait(retryDelay);
      }
    }
  }

  loadMoreSessions = async (): Promise<void> => {
    const { nextCursor, loading } = this.state.sessions;
    if (!nextCursor || loading || this.sessionsRefresh) {
      return;
    }
    this.dispatch({ type: "sessions.pending" });
    this.sessionsRefresh = this.listSessions(nextCursor)
      .then((sessions) => this.dispatch({ type: "sessions.loaded", payload: sessions, append: true }))
      .catch((error) => {
        console.warn(error);
        this.dispatch({ type: "sessions.failed" });
      })
      .finally(() => {
        this.sessionsRefresh = null;
      });
    await this.sessionsRefresh;
    if (this.sessionsRefreshDirty) {
      await this.refreshSessions();
    }
  };

  setSessionQuery = (query: string): void => this.dispatch({ type: "sessions.query", query });
  setSessionFilter = (filter: SessionFilter): void =>
    this.dispatch({ type: "sessions.filter", filter });

  /**
   * 打开会话详情只读取不可变 manifest。未成功会话走独立的只读结果接口，
   * 查询它不隐含任何 recovery，也不改变设备状态。
   */
  openSession = async (sessionId: string, producerOutcome: string): Promise<void> => {
    this.dispatch({ type: "session.opened", sessionId });
    if (producerOutcome !== "sealed") {
      try {
        const outcome = await deviceApi.getUnsuccessfulOutcome(sessionId);
        this.dispatch({ type: "session.outcome", sessionId, outcome });
      } catch (error) {
        this.dispatch({ type: "session.failed", sessionId, error: visibleError(error) });
      }
      return;
    }
    try {
      const detail = await deviceApi.getSession(sessionId);
      this.dispatch({ type: "session.detail", sessionId, detail });
    } catch (error) {
      this.dispatch({ type: "session.failed", sessionId, error: visibleError(error) });
    }
  };

  closeSession = (): void => this.dispatch({ type: "session.closed" });

  startCapture = async (displayName: string): Promise<void> => {
    if (this.state.commandPending || this.state.connection !== "connected") {
      return;
    }
    this.dispatch({ type: "command.pending" });
    try {
      const capture = await deviceApi.startCapture(displayName);
      if (capture) {
        this.dispatch({ type: "capture.snapshot", payload: capture });
      }
      await this.refreshCapture();
      this.dispatch({ type: "command.succeeded" });
    } catch (error) {
      this.dispatch({ type: "command.failed", error: visibleError(error) });
    } finally {
      this.dispatch({ type: "command.settled" });
    }
  };

  stopCapture = async (reason: "user" | "safe_swap"): Promise<void> => {
    if (this.state.commandPending || this.state.connection !== "connected") {
      return;
    }
    const stoppedSessionId =
      reason === "user"
        ? (this.state.capture?.snapshot.active_recording?.recording_state.session_id ?? null)
        : null;
    this.dispatch({ type: "command.pending" });
    try {
      const beforeStop = this.state.capture;
      const capture = await deviceApi.stopCapture(reason);
      if (capture) {
        this.dispatch({ type: "capture.snapshot", payload: capture });
      }
      await this.refreshCapture();
      await this.refreshRelatedResources();
      if (stoppedSessionId) {
        await this.refreshStoppedSession(beforeStop, stoppedSessionId);
      }
      this.dispatch({ type: "command.succeeded" });
    } catch (error) {
      this.dispatch({ type: "command.failed", error: visibleError(error) });
    } finally {
      this.dispatch({ type: "command.settled" });
    }
  };

  private async refreshStoppedSession(
    beforeStop: CaptureStatus | null,
    stoppedSessionId: string,
  ): Promise<void> {
    let sealedSessionId = sealedTerminalSessionId(beforeStop, this.state.capture);
    for (const retryDelay of TERMINAL_CAPTURE_RETRY_DELAYS_MS) {
      if (sealedSessionId) {
        break;
      }
      await wait(retryDelay);
      await this.refreshCapture();
      sealedSessionId = sealedTerminalSessionId(beforeStop, this.state.capture);
    }
    if (sealedSessionId === stoppedSessionId) {
      await this.refreshRelatedResources();
      await this.refreshSessionsUntilVisible(stoppedSessionId);
    }
  }

  private networkRefresh: Promise<void> | null = null;

  refreshNetwork = async (): Promise<void> => {
    if (!this.networkRefresh) {
      this.networkRefresh = deviceApi
        .getDevice()
        .then(async (device) => {
          this.dispatch({ type: "device.loaded", payload: device });
          if (!device.capabilities.network_mutation) {
            this.dispatch({ type: "network.loaded", payload: null });
            return;
          }
          const network = await deviceApi.getNetwork();
          this.dispatch({ type: "network.loaded", payload: network });
        })
        .catch((error) => console.warn(error))
        .finally(() => {
          this.networkRefresh = null;
        });
    }
    await this.networkRefresh;
  };

  setNetworkDraft = (patch: Partial<NetworkDraft>): void =>
    this.dispatch({ type: "network.draft", patch });

  disarmNetwork = (): void => this.dispatch({ type: "network.armed", armed: false });

  /**
   * 两步提交：第一次只是武装——先把断线后果讲清楚，再让操作者确认。
   * 这是唯一需要显式确认的命令，因为它可能切断操作者自己访问设备的链路。
   */
  submitNetwork = async (): Promise<void> => {
    const { networkDraft: draft, networkPending, networkArmed, connection } = this.state;
    if (
      networkPending ||
      connection !== "connected" ||
      this.state.device?.capabilities.network_mutation !== true
    ) {
      return;
    }
    const request: Record<string, unknown> = { mode: draft.mode };
    if (draft.mode === "wifi-client" || draft.mode === "hotspot") {
      const ssid = draft.ssid.trim();
      if (!ssid || !draft.psk) {
        return;
      }
      request.ssid = ssid;
      request.psk = draft.psk;
    } else if (draft.mode === "ethernet-static") {
      const address = draft.address.trim();
      if (!address) {
        return;
      }
      request.address = address;
      const gateway = draft.gateway.trim();
      if (gateway) {
        request.gateway = gateway;
      }
      const dns = draft.dns
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (dns.length > 0) {
        request.dns = dns;
      }
    } else if (draft.mode !== "ethernet-dhcp") {
      return;
    }

    if (!networkArmed) {
      this.dispatch({ type: "network.armed", armed: true });
      return;
    }

    this.dispatch({ type: "network.pending" });
    try {
      const result = await deviceApi.setNetwork(request);
      this.dispatch({ type: "network.succeeded", payload: result as never });
      try {
        await this.refreshNetwork();
      } catch (error) {
        console.warn(error);
      }
    } catch (error) {
      this.dispatch({ type: "command.failed", error: visibleError(error) });
    } finally {
      this.dispatch({ type: "network.settled" });
    }
  };

  setCameraFocus = async (request: { value?: number; auto_enabled?: boolean }): Promise<void> => {
    if (this.state.focusPending) {
      return;
    }
    this.dispatch({ type: "camera-focus.pending" });
    try {
      const focus = await deviceApi.setCameraFocus(request);
      this.dispatch({ type: "camera-focus.updated", payload: focus });
    } catch (error) {
      this.dispatch({ type: "command.failed", error: visibleError(error) });
    } finally {
      this.dispatch({ type: "camera-focus.settled" });
    }
  };

  /**
   * SSE 的 next-revision 快速路径：只有严格 +1 的快照可以直接投影，
   * 其余一律回到 HTTP 权威快照重取，游标过旧或出现 gap 时同理。
   */
  acceptCaptureEvent = async (event: CaptureEvent): Promise<void> => {
    if (event.type === "progress") {
      await this.refreshCapture();
      return;
    }
    if (event.type === "state") {
      if (isCaptureStateEventPayload(event.data)) {
        await this.refreshCapture();
      }
      return;
    }
    const current = this.state.capture;
    const isNextSnapshot =
      event.type === "snapshot" &&
      current &&
      event.authority_epoch === current.authority_epoch &&
      event.source_revision === current.source_revision + 1;
    if (isNextSnapshot || (event.type === "snapshot" && !current)) {
      const capture = {
        schema: "ylx.capture-status.v4",
        authority_epoch: event.authority_epoch,
        source_revision: event.source_revision,
        snapshot: event.data as never,
      };
      this.dispatch({
        type: "capture.snapshot",
        payload: capture,
      });
      await this.refreshRelatedResources();
      const stoppedSessionId = sealedTerminalSessionId(current, capture);
      if (stoppedSessionId) {
        await this.refreshSessionsUntilVisible(stoppedSessionId);
      }
      return;
    }
    const matchesCurrent =
      current &&
      event.authority_epoch === current.authority_epoch &&
      event.source_revision === current.source_revision;
    if (matchesCurrent && event.type === "safe_swap") {
      const accepted = this.acceptSafeSwapReceipt(
        event.data,
        event.authority_epoch,
        event.source_revision,
        event.session_id ?? null,
      );
      if (accepted) {
        await this.refreshRelatedResources();
      }
      return;
    }
    const diagnosticEnvelope = event.data as { schema?: string; diagnostic?: unknown } | null;
    if (
      matchesCurrent &&
      event.type === "diagnostic" &&
      diagnosticEnvelope?.schema === "ylx.capture-diagnostic-event.v2"
    ) {
      this.dispatch({
        type: "diagnostic.received",
        payload: diagnosticEnvelope.diagnostic as never,
      });
      return;
    }
    const beforeRefresh = this.state.capture;
    await this.refreshCapture();
    if (event.type === "safe_swap" || event.type === "snapshot") {
      await this.refreshRelatedResources();
      const stoppedSessionId = sealedTerminalSessionId(beforeRefresh, this.state.capture);
      if (stoppedSessionId) {
        await this.refreshSessionsUntilVisible(stoppedSessionId);
      }
    }
  };
}

export const store = new EchoStore();
