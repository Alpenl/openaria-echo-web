import type {
  NetworkApplyDesiredState,
  NetworkCredentialReceipt,
  NetworkDesiredEthernet,
  NetworkDesiredState,
  NetworkEvent,
  NetworkInterfaceStatus,
  NetworkScanEntry,
  NetworkScanResult,
  NetworkStaticIpv4,
  NetworkStatus,
  NetworkTransaction,
  NetworkTransactionReceipt,
  NetworkWifiSecurity,
} from "./types";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_.:-]+$/;
const MDNS_HOST = /^[A-Za-z0-9_.-]{1,122}\.local$/;
const MDNS_TOKEN = /^[A-Za-z0-9_.-]{1,128}$/;
const CREDENTIAL_REF = /^cred-[A-Za-z0-9_.:-]+$/;

const MODES = new Set(["hotspot", "wifi-client", "ethernet-dhcp", "ethernet-static"]);
const WIFI_SECURITY = new Set<NetworkWifiSecurity>([
  "open",
  "wpa2-personal",
  "wpa3-personal",
  "wpa2-wpa3-personal",
]);
const INTERFACE_STATES = new Set([
  "disabled",
  "disconnected",
  "starting",
  "connecting",
  "connected",
  "active",
  "degraded",
  "failed",
  "unavailable",
]);
const ACTIVE_INTERFACE_STATES = new Set(["connected", "active", "degraded"]);
const TRANSACTION_OPERATIONS = new Set(["apply", "retry", "forget"]);
const TRANSACTION_STATUSES = new Set(["accepted", "running", "committed", "rescued", "failed"]);
const TRANSACTION_STAGES = new Set([
  "accepted",
  "prepared",
  "ap_ready",
  "activating",
  "verifying",
  "committed",
  "falling_back",
  "rescued",
  "failed",
  "forgetting",
  "forgotten",
]);
const RECOVERY_ACTIONS = new Set([
  "await_device",
  "reconnect_target_lan",
  "reconnect_rescue_ap",
  "retry",
  "service_required",
  "none",
]);
const TRANSACTION_ERROR_CODES = new Set([
  "rescue_ap_unavailable",
  "credential_rejected",
  "dhcp_timeout",
  "route_lost",
  "network_manager_unavailable",
  "concurrency_unsupported",
]);
const MUTATION_DISABLED_REASONS = new Set([
  "not_enabled",
  "auth_profile_unavailable",
  "controller_unavailable",
  "network_manager_unavailable",
  "rescue_ap_not_validated",
  "capture_active",
  "recovery_required",
  "maintenance_window_closed",
  "unsupported_concurrency",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isSsid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 32
  );
}

function isIpv4(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) &&
        String(Number(part)) === part &&
        Number(part) >= 0 &&
        Number(part) <= 255,
    )
  );
}

function isStaticIpv4(value: unknown): value is NetworkStaticIpv4 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["address", "prefix_length", "gateway", "dns"]) ||
    !isIpv4(value.address) ||
    !isInteger(value.prefix_length, 1) ||
    value.prefix_length > 32 ||
    (value.gateway !== null && !isIpv4(value.gateway)) ||
    !Array.isArray(value.dns) ||
    value.dns.length > 3 ||
    !value.dns.every(isIpv4)
  ) {
    return false;
  }
  return new Set(value.dns).size === value.dns.length;
}

function isDesiredEthernet(value: unknown): value is NetworkDesiredEthernet {
  if (!isRecord(value) || !hasExactKeys(value, ["addressing", "static_ipv4"])) {
    return false;
  }
  return (
    (value.addressing === "dhcp" && value.static_ipv4 === null) ||
    (value.addressing === "static" && isStaticIpv4(value.static_ipv4))
  );
}

function isDesiredWifi(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["ssid", "security", "credential_state"]) &&
    isSsid(value.ssid) &&
    WIFI_SECURITY.has(value.security as NetworkWifiSecurity) &&
    new Set(["absent", "pending_input", "stored"]).has(String(value.credential_state))
  );
}

function isDesiredState(value: unknown): value is NetworkDesiredState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["mode", "wifi_client", "ethernet"]) ||
    !MODES.has(String(value.mode)) ||
    (value.wifi_client !== null && !isDesiredWifi(value.wifi_client)) ||
    (value.ethernet !== null && !isDesiredEthernet(value.ethernet))
  ) {
    return false;
  }
  return !(
    (value.mode === "wifi-client" && value.wifi_client === null) ||
    (value.mode === "ethernet-static" && value.ethernet === null)
  );
}

export function isNetworkApplyDesiredState(value: unknown): value is NetworkApplyDesiredState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["mode", "wifi_client", "ethernet"]) ||
    !MODES.has(String(value.mode)) ||
    (value.ethernet !== null && !isDesiredEthernet(value.ethernet))
  ) {
    return false;
  }
  if (value.mode !== "wifi-client") {
    if (value.wifi_client !== null) {
      return false;
    }
    return value.mode !== "ethernet-static" || value.ethernet !== null;
  }
  const wifi = value.wifi_client;
  if (!isRecord(wifi) || !isSsid(wifi.ssid) || !WIFI_SECURITY.has(wifi.security as NetworkWifiSecurity)) {
    return false;
  }
  const expectedKeys = wifi.security === "open" ? ["ssid", "security"] : ["ssid", "security", "credential_ref"];
  return (
    hasExactKeys(wifi, expectedKeys) &&
    (wifi.security === "open" ||
      (isBoundedString(wifi.credential_ref, 1, 128) && CREDENTIAL_REF.test(wifi.credential_ref)))
  );
}

function isNetworkInterface(value: unknown): value is NetworkInterfaceStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["state", "interface", "addresses", "peer_or_ssid"]) ||
    !INTERFACE_STATES.has(String(value.state)) ||
    (value.interface !== null &&
      (!isBoundedString(value.interface, 1, 64) || !TOKEN.test(value.interface))) ||
    !Array.isArray(value.addresses) ||
    !value.addresses.every((address) => isBoundedString(address, 1, 64)) ||
    new Set(value.addresses).size !== value.addresses.length ||
    (value.peer_or_ssid !== null && !isBoundedString(value.peer_or_ssid, 1, 128))
  ) {
    return false;
  }
  return !(
    ACTIVE_INTERFACE_STATES.has(String(value.state)) &&
    (value.interface === null || value.addresses.length === 0)
  );
}

function isTransaction(value: unknown): value is NetworkTransaction {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema",
      "authority_epoch",
      "source_revision",
      "transaction_id",
      "operation",
      "status",
      "stage",
      "desired",
      "accepted_at",
      "updated_at",
      "deadline",
      "recovery_action",
      "rescue",
      "error",
    ]) ||
    value.schema !== "ylx.network-transaction.v1" ||
    typeof value.authority_epoch !== "string" ||
    !UUID_V4.test(value.authority_epoch) ||
    !isInteger(value.source_revision, 0) ||
    typeof value.transaction_id !== "string" ||
    !UUID_V7.test(value.transaction_id) ||
    !TRANSACTION_OPERATIONS.has(String(value.operation)) ||
    !TRANSACTION_STATUSES.has(String(value.status)) ||
    !TRANSACTION_STAGES.has(String(value.stage)) ||
    !isDesiredState(value.desired) ||
    !isDateTime(value.accepted_at) ||
    !isDateTime(value.updated_at) ||
    !RECOVERY_ACTIONS.has(String(value.recovery_action))
  ) {
    return false;
  }
  if (value.deadline !== null) {
    if (
      !isRecord(value.deadline) ||
      !hasExactKeys(value.deadline, ["time_base", "deadline_ns", "remaining_seconds"]) ||
      value.deadline.time_base !== "device_monotonic" ||
      !isInteger(value.deadline.deadline_ns, 0) ||
      typeof value.deadline.remaining_seconds !== "number" ||
      !Number.isFinite(value.deadline.remaining_seconds) ||
      value.deadline.remaining_seconds < 0 ||
      value.deadline.remaining_seconds > 10
    ) {
      return false;
    }
  }
  const rescue = value.rescue;
  if (
    !isRecord(rescue) ||
    !hasExactKeys(rescue, ["ap_validated", "fallback_mode", "failure_trigger_seconds"]) ||
    typeof rescue.ap_validated !== "boolean" ||
    rescue.fallback_mode !== "hotspot" ||
    rescue.failure_trigger_seconds !== 10
  ) {
    return false;
  }
  const error = value.error;
  const validError =
    error === null ||
    (isRecord(error) &&
      hasExactKeys(error, ["code", "message", "retryable"]) &&
      TRANSACTION_ERROR_CODES.has(String(error.code)) &&
      isBoundedString(error.message, 1, 512) &&
      typeof error.retryable === "boolean");
  if (!validError) {
    return false;
  }

  const status = String(value.status);
  const stage = String(value.stage);
  const terminal = new Set(["committed", "rescued", "failed"]).has(status);
  return !(
    (status === "accepted" && stage !== "accepted") ||
    (status === "committed" && !new Set(["committed", "forgotten"]).has(stage)) ||
    (status === "rescued" && stage !== "rescued") ||
    (status === "failed" && stage !== "failed") ||
    (new Set(["accepted", "running", "committed"]).has(status) && error !== null) ||
    (new Set(["rescued", "failed"]).has(status) && error === null) ||
    (terminal && value.deadline !== null) ||
    (new Set(["activating", "verifying"]).has(stage) && value.deadline === null) ||
    (status === "rescued" && value.recovery_action !== "reconnect_rescue_ap")
  );
}

function isObservedState(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["ap", "wifi_client", "wired", "default_route", "mdns", "devices"]) ||
    !isNetworkInterface(value.ap) ||
    !isNetworkInterface(value.wifi_client) ||
    !isNetworkInterface(value.wired) ||
    !new Set(["wifi_client", "wired", "none"]).has(String(value.default_route))
  ) {
    return false;
  }
  const mdns = value.mdns;
  if (
    !isRecord(mdns) ||
    !hasExactKeys(mdns, ["hostname", "service", "aliases", "port"]) ||
    typeof mdns.hostname !== "string" ||
    !MDNS_HOST.test(mdns.hostname) ||
    typeof mdns.service !== "string" ||
    !MDNS_TOKEN.test(mdns.service) ||
    !Array.isArray(mdns.aliases) ||
    mdns.aliases.length > 16 ||
    !mdns.aliases.every((alias) => typeof alias === "string" && MDNS_TOKEN.test(alias)) ||
    new Set(mdns.aliases).size !== mdns.aliases.length ||
    !isInteger(mdns.port, 1) ||
    mdns.port > 65535
  ) {
    return false;
  }
  if (!Array.isArray(value.devices) || value.devices.length > 64) {
    return false;
  }
  const interfaces = new Set<string>();
  for (const device of value.devices) {
    if (
      !isRecord(device) ||
      !hasExactKeys(device, ["interface", "type", "state"]) ||
      ![device.interface, device.type, device.state].every(
        (item) => typeof item === "string" && item.length <= 64 && TOKEN.test(item),
      ) ||
      interfaces.has(String(device.interface))
    ) {
      return false;
    }
    interfaces.add(String(device.interface));
  }
  return true;
}

function isMutationCapability(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "enabled",
      "disabled_reason",
      "operations",
      "idempotency_key_required",
      "secret_handling",
      "active_state_policy",
    ]) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.operations) ||
    value.operations.join("\0") !== ["apply", "retry", "forget"].join("\0") ||
    value.idempotency_key_required !== true ||
    value.secret_handling !== "opaque_credential_reference_only" ||
    value.active_state_policy !== "idle_only"
  ) {
    return false;
  }
  return value.enabled
    ? value.disabled_reason === null
    : typeof value.disabled_reason === "string" &&
        MUTATION_DISABLED_REASONS.has(value.disabled_reason);
}

function isConcurrencyCapability(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "rescue_ap_required",
      "same_phy_ap_sta",
      "exclusive_client_failure_timeout_seconds",
      "max_managed_interfaces",
      "max_ap_interfaces",
    ]) &&
    value.rescue_ap_required === true &&
    new Set(["supported", "unsupported", "unverified"]).has(String(value.same_phy_ap_sta)) &&
    value.exclusive_client_failure_timeout_seconds === 10 &&
    isInteger(value.max_managed_interfaces, 0) &&
    value.max_managed_interfaces <= 8 &&
    isInteger(value.max_ap_interfaces, 0) &&
    value.max_ap_interfaces <= 8
  );
}

export function isNetworkStatus(value: unknown): value is NetworkStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema",
      "authority_epoch",
      "source_revision",
      "observed_at",
      "saved",
      "verified",
      "desired",
      "observed",
      "transaction",
      "mutation_capability",
      "concurrency_capability",
    ]) ||
    value.schema !== "ylx.network-status.v1" ||
    typeof value.authority_epoch !== "string" ||
    !UUID_V4.test(value.authority_epoch) ||
    !isInteger(value.source_revision, 0) ||
    !isDateTime(value.observed_at) ||
    typeof value.saved !== "boolean" ||
    typeof value.verified !== "boolean" ||
    (value.verified && !value.saved) ||
    !isDesiredState(value.desired) ||
    !isObservedState(value.observed) ||
    !isMutationCapability(value.mutation_capability) ||
    !isConcurrencyCapability(value.concurrency_capability)
  ) {
    return false;
  }
  const transaction = value.transaction;
  if (!isRecord(transaction) || !hasExactKeys(transaction, ["current", "latest"])) {
    return false;
  }
  const sourceRevision = value.source_revision as number;
  const transactionsValid = [transaction.current, transaction.latest].every(
    (item) =>
      item === null ||
      (isTransaction(item) &&
        item.authority_epoch === value.authority_epoch &&
        item.source_revision <= sourceRevision),
  );
  return (
    transactionsValid &&
    (transaction.current === null ||
      (isTransaction(transaction.current) &&
        new Set(["accepted", "running"]).has(transaction.current.status)))
  );
}

function isScanEntry(value: unknown): value is NetworkScanEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["ssid", "hidden", "security", "signal_dbm", "credential_required"]) ||
    typeof value.hidden !== "boolean" ||
    !WIFI_SECURITY.has(value.security as NetworkWifiSecurity) ||
    !isInteger(value.signal_dbm, -127) ||
    value.signal_dbm > 0 ||
    typeof value.credential_required !== "boolean"
  ) {
    return false;
  }
  return (
    (value.hidden ? value.ssid === null : isSsid(value.ssid)) &&
    (value.security === "open" ? value.credential_required === false : value.credential_required)
  );
}

export function isNetworkScanResult(value: unknown): value is NetworkScanResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["schema", "authority_epoch", "source_revision", "scanned_at", "networks"]) &&
    value.schema === "ylx.network-scan.v1" &&
    typeof value.authority_epoch === "string" &&
    UUID_V4.test(value.authority_epoch) &&
    isInteger(value.source_revision, 0) &&
    isDateTime(value.scanned_at) &&
    Array.isArray(value.networks) &&
    value.networks.length <= 256 &&
    value.networks.every(isScanEntry)
  );
}

export function isNetworkCredentialReceipt(value: unknown): value is NetworkCredentialReceipt {
  if (
    !(
    isRecord(value) &&
    hasExactKeys(value, [
      "schema",
      "credential_ref",
      "issued_at",
      "expires_at",
      "ttl_seconds",
      "single_use",
    ]) &&
    value.schema === "ylx.network-credential-receipt.v1" &&
    isBoundedString(value.credential_ref, 1, 128) &&
    CREDENTIAL_REF.test(value.credential_ref) &&
    isDateTime(value.issued_at) &&
    isDateTime(value.expires_at) &&
    isInteger(value.ttl_seconds, 1) &&
    value.ttl_seconds <= 120 &&
    value.single_use === true
    )
  ) {
    return false;
  }
  return Date.parse(value.expires_at) - Date.parse(value.issued_at) === value.ttl_seconds * 1000;
}

export function isNetworkTransactionReceipt(value: unknown): value is NetworkTransactionReceipt {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["schema", "accepted_at", "transaction"]) &&
    value.schema === "ylx.network-transaction-receipt.v1" &&
    isDateTime(value.accepted_at) &&
    isTransaction(value.transaction) &&
    value.transaction.status === "accepted" &&
    value.accepted_at === value.transaction.accepted_at
  );
}

export function isNetworkEvent(value: unknown): value is NetworkEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema",
      "sse_delivery_id",
      "authority_epoch",
      "source_revision",
      "occurred_at",
      "type",
      "transaction_id",
      "data",
    ]) ||
    value.schema !== "ylx.network-event.v1" ||
    typeof value.sse_delivery_id !== "string" ||
    !/^\d+$/.test(value.sse_delivery_id) ||
    typeof value.authority_epoch !== "string" ||
    !UUID_V4.test(value.authority_epoch) ||
    !isInteger(value.source_revision, 0) ||
    !isDateTime(value.occurred_at)
  ) {
    return false;
  }
  if (value.type === "snapshot") {
    return (
      value.transaction_id === null &&
      isNetworkStatus(value.data) &&
      value.data.authority_epoch === value.authority_epoch &&
      value.data.source_revision === value.source_revision
    );
  }
  return (
    value.type === "transaction" &&
    typeof value.transaction_id === "string" &&
    UUID_V7.test(value.transaction_id) &&
    isTransaction(value.data) &&
    value.data.transaction_id === value.transaction_id &&
    value.data.authority_epoch === value.authority_epoch &&
    value.data.source_revision === value.source_revision
  );
}
