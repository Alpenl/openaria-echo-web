/**
 * Device API v3 的 wire 类型。
 *
 * 这些类型描述 Conductor 已经交付的契约，不描述 Echo 想要的形状：
 * 字段名、可空性和 discriminator 都按 `ylx-device-v3.openapi.yaml` 与真机
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
  state: string;
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
  camera_focus?: CameraFocusStatus | null;
}

export interface DeviceCapabilities {
  capture: boolean;
  preview: boolean;
  range_download: boolean;
  network_mutation: boolean;
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

export interface NetworkStatus {
  format: "ylx.network-status.v0";
  capabilities: {
    modes: string[];
    wifi_interface: string;
    ethernet_interface: string;
    second_wifi: boolean;
  };
  mdns: { hostname: string; service: string; aliases: string[]; port: number };
  devices: Array<{ interface: string; type: string; state: string }>;
}

export type CaptureEvent = {
  schema: "ylx.capture-event.v3";
  type: "snapshot" | "progress" | "diagnostic" | "safe_swap";
  sse_delivery_id: string;
  authority_epoch: string;
  source_revision: number;
  session_id?: string | null;
  data: unknown;
};
