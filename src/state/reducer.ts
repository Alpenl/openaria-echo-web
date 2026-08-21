import type {
  CameraFocusStatus,
  CaptureStatus,
  DeviceDescriptor,
  DeviceRuntime,
  Diagnostic,
  NetworkApplyResult,
  NetworkStatus,
  SafeSwapState,
  SessionDetail,
  SessionList,
  UnsuccessfulOutcome,
} from "../api/types";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type InspectMode = "both" | "left" | "right";
export type PanelId = "none" | "sessions" | "device";
export type SessionFilter = "all" | "usable" | "unsuccessful";
export type NetworkMode = "wifi-client" | "hotspot" | "ethernet-dhcp" | "ethernet-static";

export interface NetworkDraft {
  mode: NetworkMode;
  ssid: string;
  psk: string;
  address: string;
  gateway: string;
  dns: string;
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
  networkResult: NetworkApplyResult | null;
  networkPending: boolean;
  /** 网络变更是唯一需要显式确认的命令：它可能切断操作者自己的链路。 */
  networkArmed: boolean;
  networkDraft: NetworkDraft;
  safeSwapReceipt: SafeSwapState | null;
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
  | { type: "network.draft"; patch: Partial<NetworkDraft> }
  | { type: "network.armed"; armed: boolean }
  | { type: "network.pending" }
  | { type: "network.settled" }
  | { type: "network.succeeded"; payload: NetworkApplyResult }
  | { type: "error.cleared" }
  | { type: "safe-swap.received"; payload: SafeSwapState }
  | { type: "safe-swap.cleared" }
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
  | { type: "full-frame.toggled" };

export const initialState: AppState = {
  connection: "connecting",
  device: null,
  capture: null,
  networkStatus: null,
  networkResult: null,
  networkPending: false,
  networkArmed: false,
  networkDraft: { mode: "wifi-client", ssid: "", psk: "", address: "", gateway: "", dns: "" },
  safeSwapReceipt: null,
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
};

function withCameraFocus(runtime: DeviceRuntime, focus: CameraFocusStatus): DeviceRuntime {
  return { ...runtime, camera_focus: focus };
}

/**
 * 一份 receipt 只在它描述的那次权威、那个 generation、那个 session 和那个卷上有效。
 * 任何一项对不上就丢弃：网页绝不能在没有有效回执时显示「可以移除」。
 */
function receiptMatchesCapture(safeSwap: SafeSwapState | null, capture: CaptureStatus): boolean {
  if (!safeSwap || safeSwap.authorityEpoch !== capture.authority_epoch) {
    return false;
  }
  const recording = capture.snapshot.active_recording ?? capture.snapshot.retained_unsuccessful;
  if (!recording) {
    return true;
  }
  return (
    recording.generation_id === safeSwap.receipt.generation_id &&
    recording.recording_state.session_id === safeSwap.receipt.session_id &&
    recording.recording_state.storage.volume_id === safeSwap.receipt.volume_id
  );
}

/** source revision 在同一 authority epoch 内严格递增，倒退的快照一律丢弃。 */
function isStaleCaptureSnapshot(current: CaptureStatus | null, incoming: CaptureStatus): boolean {
  return (
    current !== null &&
    incoming.authority_epoch === current.authority_epoch &&
    incoming.source_revision < current.source_revision
  );
}

export function reduceState(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "device.loaded": {
      const safeSwapReceipt =
        state.safeSwapReceipt?.receipt.volume_id === action.payload.storage.volume_id
          ? state.safeSwapReceipt
          : null;
      return { ...state, device: action.payload, safeSwapReceipt };
    }
    case "capture.snapshot": {
      if (isStaleCaptureSnapshot(state.capture, action.payload)) {
        return state;
      }
      return {
        ...state,
        capture: action.payload,
        safeSwapReceipt: receiptMatchesCapture(state.safeSwapReceipt, action.payload)
          ? state.safeSwapReceipt
          : null,
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
    case "network.loaded":
      return { ...state, networkStatus: action.payload };
    case "network.draft":
      // 改动草稿即解除武装：确认过的后果不能顺延到另一份配置。
      return {
        ...state,
        networkDraft: { ...state.networkDraft, ...action.patch },
        networkArmed: false,
      };
    case "network.armed":
      return { ...state, networkArmed: action.armed };
    case "network.pending":
      return { ...state, networkPending: true, networkArmed: false, error: null };
    case "network.settled":
      return { ...state, networkPending: false };
    case "network.succeeded":
      return { ...state, networkResult: action.payload, error: null };
    case "error.cleared":
      return { ...state, error: null };
    case "safe-swap.received":
      return { ...state, safeSwapReceipt: action.payload };
    case "safe-swap.cleared":
      return { ...state, safeSwapReceipt: null };
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
