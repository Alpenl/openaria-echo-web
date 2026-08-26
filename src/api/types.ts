/**
 * Device API v4 的 wire 类型。
 *
 * 这些类型描述 Conductor 已经交付的契约，不描述 Echo 想要的形状：
 * 字段名、可空性和 discriminator 都按 `ylx-device-v4.openapi.yaml` 与真机
 * 响应逐字对应。任何看起来更方便的重命名都会在 dual-read 时咬人。
 */

export interface DeviceIdentity {
  device_id: string;
  device_label: string;
}

export interface RawVector3 {
  x: number;
  y: number;
  z: number;
}

export interface NetworkInterfaceStatus {
  state:
    | "disabled"
    | "disconnected"
    | "starting"
    | "connecting"
    | "connected"
    | "active"
    | "degraded"
    | "failed"
    | "unavailable";
  interface: string | null;
  addresses: string[];
  peer_or_ssid: string | null;
}

export interface LiveImu {
  session_id: string;
  clock: { time_base: "host_monotonic"; timestamp_ns: number };
  raw: { units: "raw_int16"; accelerometer: RawVector3; gyroscope: RawVector3 };
  sync: { quality: "insufficient" | "good" | "degraded" };
}

export interface CameraFocusStatus {
  schema: "ylx.camera-focus.v1";
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  default: number;
  auto_supported: boolean;
  auto_enabled: boolean | null;
}

export interface CameraConnectionStatus {
  schema: "ylx.camera-connection.v1";
  state: "connected" | "disconnected";
}

export interface DeviceRuntime {
  observed_at: string;
  connection_method: string;
  temperature_celsius: number;
  network: {
    ap: NetworkInterfaceStatus;
    wifi_client: NetworkInterfaceStatus;
    wired: NetworkInterfaceStatus;
    default_route: string;
  };
  live_imu: LiveImu | null;
  camera: CameraConnectionStatus;
  camera_focus: CameraFocusStatus | null;
}

export type CalibrationCaptureDisabledReason =
  | "raw_side_by_side_required"
  | "native_raw_sink_unavailable"
  | "storage_unavailable"
  | "hardware_unavailable"
  | "maintenance_or_capture_busy";

export interface CalibrationCaptureCapability {
  supported: boolean;
  enabled: boolean;
  disabled_reason: CalibrationCaptureDisabledReason | null;
  required_video_layout: "raw-side-by-side";
}

export interface DeviceCapabilities {
  capture: boolean;
  preview: boolean;
  range_download: boolean;
  network_mutation: boolean;
  calibration_capture: CalibrationCaptureCapability;
}

export interface DeviceDescriptor {
  schema?: string;
  device: DeviceIdentity;
  hardware_fingerprint?: string;
  api_version?: string;
  build?: { package_version: string; commit: string; build_id: string };
  security_profile?: string;
  capabilities: DeviceCapabilities;
  storage: {
    volume_id: string | null;
    total_bytes: number;
    available_bytes: number;
    writable: boolean;
  };
  runtime: DeviceRuntime;
}

export interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  at: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

export interface RecordingState {
  schema: string;
  state: string;
  authority_epoch: string;
  state_revision: number;
  updated_at: string;
  session_id: string;
  take_id: string;
  display_name: string;
  device: DeviceIdentity;
  storage: {
    volume_id: string;
    status: string;
    writable: boolean;
    remaining_bytes: number | null;
  };
  diagnostics: Diagnostic[];
  progress: {
    elapsed_seconds: number;
    captured_frames: number;
    bytes_written: number;
    encoding?: { completed: number; total: number };
    verification?: { completed: number; total: number };
  };
}

export interface RecordingGeneration {
  generation_id: string;
  recording_state: RecordingState;
}

export interface CaptureSnapshot {
  schema: string;
  device_state: string;
  active_recording: RecordingGeneration | null;
  retained_unsuccessful: RecordingGeneration | null;
  runtime: DeviceRuntime;
}

export interface CaptureStatus {
  schema: string;
  authority_epoch: string;
  source_revision: number;
  snapshot: CaptureSnapshot;
}

export interface SafeSwapReceipt {
  schema: "ylx.safe-swap-receipt.v3";
  session_id: string;
  volume_id: string;
  generation_id: string;
  manifest_id: string;
  manifest_sha256: string;
  sealed_at: string;
  released_at: string;
  release_state: "unmounted" | "device-released";
  open_handle_count: 0;
}

export interface SafeSwapState {
  receipt: SafeSwapReceipt;
  authorityEpoch: string;
  sourceRevision: number;
}

/** 生产方自洽声明与消费方独立判断是两件事，列表里分开投影，绝不合并成一个状态。 */
export interface SessionVerification {
  actor?: string;
  validator?: { name: string; version: string; build_sha256: string };
  manifest_sha256?: string;
  verified_at?: string;
  verdict: "usable" | "unusable";
  diagnostics: unknown[];
}

export interface SessionSummary {
  session_id: string;
  producer_outcome: string;
  take_id?: string;
  take_sequence?: number;
  continuation_of?: string | null;
  display_name: string;
  device?: DeviceIdentity;
  started_at?: string;
  ended_at?: string;
  duration_seconds: number;
  total_bytes: number;
  verification: SessionVerification | null;
}

export interface SessionListDiagnostic {
  quarantine_id: string;
  code: string;
  observed_at: string;
  message: string;
}

export interface SessionList {
  schema?: string;
  items: SessionSummary[];
  diagnostics: SessionListDiagnostic[];
  next_cursor: string | null;
}

/** manifest 里的 artifact 条目；Range 下载按 artifact_id 寻址，不按 path 猜角色。 */
export interface SessionArtifact {
  artifact_id: string;
  bytes: number;
  media_type: string;
  path: string;
  role: string;
  sha256: string;
}

export interface SessionDetail {
  schema: string;
  session_id: string;
  manifest_id: string;
  volume_id: string;
  display_name: string;
  capture_mode: string;
  sealed: boolean;
  sealed_at: string;
  device: {
    device_id: string;
    device_label: string;
    platform?: string;
    software_version?: string;
    commit?: string;
    hardware_fingerprint?: string;
  };
  take: { take_id: string; sequence: number; continuation_of: string | null };
  time: {
    started_at: string;
    ended_at: string;
    duration_seconds: number;
    duration_clock?: string;
    timezone?: string;
  };
  camera?: {
    width: number;
    height: number;
    eye_width: number;
    nominal_fps: number;
    sensor_fps?: number;
    effective_fps?: number;
    frame_decimation?: number;
    coordinate_frame?: string;
  };
  video?: {
    codec: string;
    container: string;
    layout: string;
    segments: Array<{
      index: number;
      start_frame?: number;
      end_frame?: number;
      start_time_seconds?: number;
      end_time_seconds?: number;
      artifacts: { left?: SessionArtifact; right?: SessionArtifact };
    }>;
  };
  audio?: {
    codec: string;
    container: string;
    sample_rate_hz: number;
    channels: number;
    segments: Array<{ index: number; artifact: SessionArtifact }>;
  } | null;
  frames?: { count: number; artifact: SessionArtifact };
  imu?: { artifact: SessionArtifact; coordinate_frame?: string };
  logs?: Array<{ artifact: SessionArtifact }> | [];
  integrity?: {
    dropped_frames: number;
    drop_events: unknown[];
    fatal_errors: unknown[];
    media_write_throughput_bytes_per_second?: number;
    quality_policy?: { policy_id: string };
    verified_at?: string;
  };
}

/** 未成功会话的只读结果接口：查询它不隐含任何 recovery 行为。 */
export interface UnsuccessfulOutcome {
  schema: string;
  session_id: string;
  outcome: string;
  [key: string]: unknown;
}

export type NetworkMode = "hotspot" | "wifi-client" | "ethernet-dhcp" | "ethernet-static";
export type NetworkWifiSecurity =
  | "open"
  | "wpa2-personal"
  | "wpa3-personal"
  | "wpa2-wpa3-personal";

export interface NetworkStaticIpv4 {
  address: string;
  prefix_length: number;
  gateway: string | null;
  dns: string[];
}

export interface NetworkDesiredEthernet {
  addressing: "dhcp" | "static";
  static_ipv4: NetworkStaticIpv4 | null;
}

export interface NetworkDesiredState {
  mode: NetworkMode;
  wifi_client: {
    ssid: string;
    security: NetworkWifiSecurity;
    credential_state: "absent" | "pending_input" | "stored";
  } | null;
  ethernet: NetworkDesiredEthernet | null;
}

export interface NetworkTransaction {
  schema: "ylx.network-transaction.v1";
  authority_epoch: string;
  source_revision: number;
  transaction_id: string;
  operation: "apply" | "retry" | "forget";
  status: "accepted" | "running" | "committed" | "rescued" | "failed";
  stage:
    | "accepted"
    | "prepared"
    | "ap_ready"
    | "activating"
    | "verifying"
    | "committed"
    | "falling_back"
    | "rescued"
    | "failed"
    | "forgetting"
    | "forgotten";
  desired: NetworkDesiredState;
  accepted_at: string;
  updated_at: string;
  deadline: {
    time_base: "device_monotonic";
    deadline_ns: number;
    remaining_seconds: number;
  } | null;
  recovery_action:
    | "await_device"
    | "reconnect_target_lan"
    | "reconnect_rescue_ap"
    | "retry"
    | "service_required"
    | "none";
  rescue: {
    ap_validated: boolean;
    fallback_mode: "hotspot";
    failure_trigger_seconds: 10;
  };
  error: {
    code:
      | "rescue_ap_unavailable"
      | "credential_rejected"
      | "dhcp_timeout"
      | "route_lost"
      | "network_manager_unavailable"
      | "concurrency_unsupported";
    message: string;
    retryable: boolean;
  } | null;
}

export interface NetworkStatus {
  schema: "ylx.network-status.v1";
  authority_epoch: string;
  source_revision: number;
  observed_at: string;
  saved: boolean;
  verified: boolean;
  desired: NetworkDesiredState;
  observed: {
    ap: NetworkInterfaceStatus;
    wifi_client: NetworkInterfaceStatus;
    wired: NetworkInterfaceStatus;
    default_route: "wifi_client" | "wired" | "none";
    mdns: { hostname: string; service: string; aliases: string[]; port: number };
    devices: Array<{ interface: string; type: string; state: string }>;
  };
  transaction: {
    current: NetworkTransaction | null;
    latest: NetworkTransaction | null;
  };
  mutation_capability: {
    enabled: boolean;
    disabled_reason:
      | "not_enabled"
      | "auth_profile_unavailable"
      | "controller_unavailable"
      | "network_manager_unavailable"
      | "rescue_ap_not_validated"
      | "capture_active"
      | "recovery_required"
      | "maintenance_window_closed"
      | "unsupported_concurrency"
      | null;
    operations: ["apply", "retry", "forget"];
    idempotency_key_required: true;
    secret_handling: "opaque_credential_reference_only";
    active_state_policy: "idle_only";
  };
  concurrency_capability: {
    rescue_ap_required: true;
    same_phy_ap_sta: "supported" | "unsupported" | "unverified";
    exclusive_client_failure_timeout_seconds: 10;
    max_managed_interfaces: number;
    max_ap_interfaces: number;
  };
}

export interface NetworkScanEntry {
  ssid: string | null;
  hidden: boolean;
  security: NetworkWifiSecurity;
  signal_dbm: number;
  credential_required: boolean;
}

export interface NetworkScanResult {
  schema: "ylx.network-scan.v1";
  authority_epoch: string;
  source_revision: number;
  scanned_at: string;
  networks: NetworkScanEntry[];
}

export interface NetworkCredentialReceipt {
  schema: "ylx.network-credential-receipt.v1";
  credential_ref: string;
  issued_at: string;
  expires_at: string;
  ttl_seconds: number;
  single_use: true;
}

export interface NetworkApplyDesiredState {
  mode: NetworkMode;
  wifi_client: {
    ssid: string;
    security: NetworkWifiSecurity;
    credential_ref?: string;
  } | null;
  ethernet: NetworkDesiredEthernet | null;
}

export interface NetworkTransactionReceipt {
  schema: "ylx.network-transaction-receipt.v1";
  accepted_at: string;
  transaction: NetworkTransaction;
}

export interface NetworkEvent {
  schema: "ylx.network-event.v1";
  type: "snapshot" | "transaction";
  sse_delivery_id: string;
  authority_epoch: string;
  source_revision: number;
  occurred_at: string;
  transaction_id: string | null;
  data: NetworkStatus | NetworkTransaction;
}

export type CaptureStateEventState =
  | "recording"
  | "finalizing"
  | "encoding"
  | "verifying"
  | "recoverable"
  | "failed"
  | "abandoned";

export interface CaptureStateEventPayload {
  schema: "ylx.capture-state-event.v2";
  state: CaptureStateEventState;
  volume_id: string;
  generation_id: string;
}

export type CaptureEvent = {
  schema: "ylx.capture-event.v4";
  type: "snapshot" | "progress" | "diagnostic" | "safe_swap" | "state";
  sse_delivery_id: string;
  authority_epoch: string;
  source_revision: number;
  session_id?: string | null;
  data: unknown;
};
