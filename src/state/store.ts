import { DeviceApiError, deviceApi } from "../api/client";
import type { CaptureEvent, SafeSwapReceipt, SessionList } from "../api/types";
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
      const [device, capture] = await Promise.all([
        deviceApi.getDevice(),
        deviceApi.getCaptureStatus(),
      ]);
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
      void deviceApi
        .getNetwork()
        .then((network) => this.dispatch({ type: "network.loaded", payload: network }))
        .catch((error) => console.warn(error));
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
    if (!this.sessionsRefresh) {
      this.dispatch({ type: "sessions.pending" });
      this.sessionsRefresh = this.listSessions(null)
        .then((sessions) =>
          this.dispatch({ type: "sessions.loaded", payload: sessions, append: false }),
        )
        .catch((error) => {
          console.warn(error);
          this.dispatch({ type: "sessions.failed" });
        })
        .finally(() => {
          this.sessionsRefresh = null;
        });
    }
    await this.sessionsRefresh;
  };

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
    this.dispatch({ type: "command.pending" });
    try {
      const capture = await deviceApi.stopCapture(reason);
      if (capture) {
        this.dispatch({ type: "capture.snapshot", payload: capture });
      }
      await this.refreshCapture();
      await this.refreshRelatedResources();
      this.dispatch({ type: "command.succeeded" });
    } catch (error) {
      this.dispatch({ type: "command.failed", error: visibleError(error) });
    } finally {
      this.dispatch({ type: "command.settled" });
    }
  };

  private networkRefresh: Promise<void> | null = null;

  refreshNetwork = async (): Promise<void> => {
    if (!this.networkRefresh) {
      this.networkRefresh = Promise.all([deviceApi.getDevice(), deviceApi.getNetwork()])
        .then(([device, network]) => {
          this.dispatch({ type: "device.loaded", payload: device });
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
    if (networkPending || connection !== "connected") {
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
    const current = this.state.capture;
    const isNextSnapshot =
      event.type === "snapshot" &&
      current &&
      event.authority_epoch === current.authority_epoch &&
      event.source_revision === current.source_revision + 1;
    if (isNextSnapshot || (event.type === "snapshot" && !current)) {
      this.dispatch({
        type: "capture.snapshot",
        payload: {
          schema: "ylx.capture-status.v2",
          authority_epoch: event.authority_epoch,
          source_revision: event.source_revision,
          snapshot: event.data as never,
        },
      });
      await this.refreshRelatedResources();
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
    await this.refreshCapture();
    if (event.type === "safe_swap" || event.type === "snapshot") {
      await this.refreshRelatedResources();
    }
  };
}

export const store = new EchoStore();
