import type {
  CameraFocusStatus,
  CaptureStatus,
  DeviceDescriptor,
  DeviceRuntime,
  Diagnostic,
  NetworkScanResult,
  NetworkStatus,
  NetworkTransactionReceipt,
  SessionDetail,
  SessionList,
  UnsuccessfulOutcome,
} from "../api/types";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type InspectMode = "both" | "left" | "right";
export type PanelId = "none" | "sessions" | "device" | "network";
export type SessionFilter = "all" | "usable" | "unsuccessful";
export type NetworkOperation = "apply" | "retry" | "forget";
export type NetworkCommandPhase = "idle" | "submitting" | "accepted" | "indeterminate" | "failed";

export interface FocusPeakingState {
  enabled: boolean;
  threshold: number;
}

export interface VisibleError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SessionsState {
  items: SessionList["items"];
  diagnostics: SessionList["diagnostics"];
  nextCursor: string | null;
  loading: boolean;
  loadedOnce: boolean;
  query: string;
  filter: SessionFilter;
}

export interface SelectedSession {
  sessionId: string;
  loading: boolean;
  detail: SessionDetail | null;
  outcome: UnsuccessfulOutcome | null;
  error: VisibleError | null;
}

export interface AppState {
  connection: ConnectionState;
  device: DeviceDescriptor | null;
  capture: CaptureStatus | null;
  networkStatus: NetworkStatus | null;
  networkScan: NetworkScanResult | null;
  networkScanPending: boolean;
  networkCommand: {
    operation: NetworkOperation | null;
    phase: NetworkCommandPhase;
    transactionId: string | null;
  };
  sessions: SessionsState;
  selected: SelectedSession | null;
  diagnostics: Diagnostic[];
  commandPending: boolean;
  focusPending: boolean;
  needsCredentials: boolean;
  error: VisibleError | null;
  inspect: InspectMode;
  panel: PanelId;
  fullFrame: boolean;
  focusPeaking: FocusPeakingState;
}

export type Action =
  | { type: "device.loaded"; payload: DeviceDescriptor }
  | { type: "capture.snapshot"; payload: CaptureStatus }
  | { type: "command.pending" }
  | { type: "command.settled" }
  | { type: "command.succeeded" }
  | { type: "command.failed"; error: VisibleError }
  | { type: "camera-focus.pending" }
  | { type: "camera-focus.settled" }
  | { type: "camera-focus.updated"; payload: CameraFocusStatus }
  | { type: "network.loaded"; payload: NetworkStatus | null }
  | { type: "network.scan.pending" }
  | { type: "network.scan.loaded"; payload: NetworkScanResult }
  | { type: "network.scan.failed"; error: VisibleError }
  | { type: "network.command.pending"; operation: NetworkOperation }
  | {
      type: "network.command.accepted";
      operation: NetworkOperation;
      payload: NetworkTransactionReceipt;
    }
  | { type: "network.command.indeterminate"; operation: NetworkOperation; error: VisibleError }
  | { type: "network.command.failed"; operation: NetworkOperation; error: VisibleError }
  | { type: "error.cleared" }
  | { type: "sessions.pending" }
  | { type: "sessions.loaded"; payload: SessionList; append: boolean }
  | { type: "sessions.failed" }
  | { type: "sessions.query"; query: string }
  | { type: "sessions.filter"; filter: SessionFilter }
  | { type: "session.opened"; sessionId: string }
  | { type: "session.detail"; sessionId: string; detail: SessionDetail }
  | { type: "session.outcome"; sessionId: string; outcome: UnsuccessfulOutcome | null }
  | { type: "session.failed"; sessionId: string; error: VisibleError }
  | { type: "session.closed" }
  | { type: "diagnostic.received"; payload: Diagnostic }
  | { type: "connection.changed"; connection: ConnectionState }
  | { type: "connection.failed"; error: VisibleError }
  | { type: "credentials.required" }
  | { type: "credentials.cleared" }
  | { type: "inspect.changed"; mode: InspectMode }
  | { type: "panel.opened"; panel: PanelId }
  | { type: "panel.closed" }
  | { type: "full-frame.toggled" }
  | { type: "focus-peaking.toggled" }
  | { type: "focus-peaking.threshold"; threshold: number };

export const initialState: AppState = {
  connection: "connecting",
  device: null,
  capture: null,
  networkStatus: null,
  networkScan: null,
  networkScanPending: false,
  networkCommand: { operation: null, phase: "idle", transactionId: null },
  sessions: {
    items: [],
    diagnostics: [],
    nextCursor: null,
    loading: false,
    loadedOnce: false,
    query: "",
    filter: "all",
  },
  selected: null,
  diagnostics: [],
  commandPending: false,
  focusPending: false,
  needsCredentials: false,
  error: null,
  inspect: "both",
  panel: "none",
  fullFrame: false,
  focusPeaking: { enabled: true, threshold: 96 },
};

function withCameraFocus(runtime: DeviceRuntime, focus: CameraFocusStatus): DeviceRuntime {
  return { ...runtime, camera_focus: focus };
}

/** source revision 在同一 authority epoch 内严格递增，倒退的快照一律丢弃。 */
function isStaleCaptureSnapshot(current: CaptureStatus | null, incoming: CaptureStatus): boolean {
  return (
    current !== null &&
    incoming.authority_epoch === current.authority_epoch &&
    incoming.source_revision < current.source_revision
  );
}

function isStaleNetworkSnapshot(current: NetworkStatus | null, incoming: NetworkStatus): boolean {
  return (
    current !== null &&
    incoming.authority_epoch === current.authority_epoch &&
    incoming.source_revision < current.source_revision
  );
}

function clampPeakingThreshold(threshold: number): number {
  if (!Number.isFinite(threshold)) {
    return initialState.focusPeaking.threshold;
  }
  return Math.min(255, Math.max(0, Math.round(threshold)));
}

export function reduceState(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "device.loaded":
      return { ...state, device: action.payload };
    case "capture.snapshot": {
      if (isStaleCaptureSnapshot(state.capture, action.payload)) {
        return state;
      }
      return {
        ...state,
        capture: action.payload,
      };
    }
    case "command.pending":
      return { ...state, commandPending: true, error: null };
    case "command.settled":
      return { ...state, commandPending: false };
    case "command.succeeded":
      return { ...state, error: null };
    case "command.failed":
      return { ...state, error: action.error };
    case "camera-focus.pending":
      return { ...state, focusPending: true, error: null };
    case "camera-focus.settled":
      return { ...state, focusPending: false };
    case "camera-focus.updated":
      return {
        ...state,
        error: null,
        device: state.device
          ? { ...state.device, runtime: withCameraFocus(state.device.runtime, action.payload) }
          : state.device,
        capture: state.capture
          ? {
              ...state.capture,
              snapshot: {
                ...state.capture.snapshot,
                runtime: withCameraFocus(state.capture.snapshot.runtime, action.payload),
              },
            }
          : state.capture,
      };
    case "network.loaded": {
      if (
        action.payload !== null &&
        isStaleNetworkSnapshot(state.networkStatus, action.payload)
      ) {
        return state;
      }
      const pendingId = state.networkCommand.transactionId;
      const current = action.payload?.transaction.current ?? null;
      const latest = action.payload?.transaction.latest ?? null;
      const matching = [current, latest].find(
        (transaction) => transaction?.transaction_id === pendingId,
      );
      const networkCommand = matching
        ? {
            ...state.networkCommand,
            phase: matching.status === "committed" ||
              matching.status === "rescued" ||
              matching.status === "failed"
              ? ("idle" as const)
              : ("accepted" as const),
          }
        : state.networkCommand;
      return { ...state, networkStatus: action.payload, networkCommand };
    }
    case "network.scan.pending":
      return { ...state, networkScanPending: true, error: null };
    case "network.scan.loaded":
      return { ...state, networkScan: action.payload, networkScanPending: false, error: null };
    case "network.scan.failed":
      return { ...state, networkScanPending: false, error: action.error };
    case "network.command.pending":
      return {
        ...state,
        error: null,
        networkCommand: {
          operation: action.operation,
          phase: "submitting",
          transactionId: null,
        },
      };
    case "network.command.accepted":
      return {
        ...state,
        error: null,
        networkCommand: {
          operation: action.operation,
          phase: "accepted",
          transactionId: action.payload.transaction.transaction_id,
        },
      };
    case "network.command.indeterminate":
      return {
        ...state,
        error: action.error,
        networkCommand: {
          operation: action.operation,
          phase: "indeterminate",
          transactionId: null,
        },
      };
    case "network.command.failed":
      return {
        ...state,
        error: action.error,
        networkCommand: {
          operation: action.operation,
          phase: "failed",
          transactionId: null,
        },
      };
    case "error.cleared":
      return { ...state, error: null };
    case "sessions.pending":
      return { ...state, sessions: { ...state.sessions, loading: true } };
    case "sessions.loaded":
      return {
        ...state,
        sessions: {
          ...state.sessions,
          items: action.append
            ? [...state.sessions.items, ...action.payload.items]
            : action.payload.items,
          diagnostics: action.payload.diagnostics ?? [],
          nextCursor: action.payload.next_cursor ?? null,
          loading: false,
          loadedOnce: true,
        },
      };
    case "sessions.failed":
      return { ...state, sessions: { ...state.sessions, loading: false, loadedOnce: true } };
    case "sessions.query":
      return { ...state, sessions: { ...state.sessions, query: action.query } };
    case "sessions.filter":
      return { ...state, sessions: { ...state.sessions, filter: action.filter } };
    case "session.opened":
      return {
        ...state,
        selected: {
          sessionId: action.sessionId,
          loading: true,
          detail: null,
          outcome: null,
          error: null,
        },
      };
    case "session.detail":
      if (state.selected?.sessionId !== action.sessionId) {
        return state;
      }
      return {
        ...state,
        selected: { ...state.selected, loading: false, detail: action.detail, error: null },
      };
    case "session.outcome":
      if (state.selected?.sessionId !== action.sessionId) {
        return state;
      }
      return { ...state, selected: { ...state.selected, loading: false, outcome: action.outcome } };
    case "session.failed":
      if (state.selected?.sessionId !== action.sessionId) {
        return state;
      }
      return { ...state, selected: { ...state.selected, loading: false, error: action.error } };
    case "session.closed":
      return { ...state, selected: null };
    case "diagnostic.received":
      return { ...state, diagnostics: [...state.diagnostics.slice(-3), action.payload] };
    case "connection.changed":
      return { ...state, connection: action.connection };
    case "connection.failed":
      return { ...state, connection: "disconnected", error: action.error };
    case "credentials.required":
      return { ...state, needsCredentials: true };
    case "credentials.cleared":
      return { ...state, needsCredentials: false };
    case "inspect.changed":
      // 切换取景就回到该模式的默认取法：并置永远全画幅，单眼默认铺满。
      return { ...state, inspect: action.mode, fullFrame: false };
    case "panel.opened":
      return { ...state, panel: action.panel };
    case "panel.closed":
      return { ...state, panel: "none", selected: null };
    case "full-frame.toggled":
      return { ...state, fullFrame: !state.fullFrame };
    case "focus-peaking.toggled":
      return {
        ...state,
        focusPeaking: {
          ...state.focusPeaking,
          enabled: !state.focusPeaking.enabled,
        },
      };
    case "focus-peaking.threshold":
      return {
        ...state,
        focusPeaking: {
          ...state.focusPeaking,
          threshold: clampPeakingThreshold(action.threshold),
        },
      };
    default:
      return state;
  }
}

/**
 * Retained unsuccessful outcome 是持久历史，不是新事件。只有本页亲眼看到活动录制
 * 转入该终态时才播报它的诊断，否则刷新页面会把旧失败重放成新的页面级错误。
 */
export function shouldAnnounceRetainedDiagnostics(
  previous: AppState,
  incoming: CaptureStatus,
): boolean {
  const retained = incoming.snapshot.retained_unsuccessful;
  const active = previous.capture?.snapshot.active_recording;
  const wasCapturing = Boolean(
    previous.capture && previous.capture.snapshot.device_state !== "idle",
  );
  return Boolean(
    retained &&
      (wasCapturing ||
        (active &&
          active.generation_id === retained.generation_id &&
          active.recording_state.session_id === retained.recording_state.session_id)),
  );
}
