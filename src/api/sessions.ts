import type {
  CurrentSessionVerification,
  LegacySessionVerification,
  SessionList,
  SessionListDiagnostic,
  SessionSummary,
} from "./types";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CATALOG_REVISION = /^sha256:[0-9a-f]{64}$/;
const DEVICE_LABEL = /^YLX-[0-9A-F]{8}$/;

const LIST_V2_KEYS = new Set(["schema", "items", "diagnostics", "next_cursor"]);
const LIST_V3_KEYS = new Set([
  "schema",
  "catalog_revision",
  "items",
  "diagnostics",
  "next_cursor",
]);
const SUMMARY_KEYS = new Set([
  "session_id",
  "producer_outcome",
  "take_id",
  "take_sequence",
  "continuation_of",
  "display_name",
  "device",
  "started_at",
  "ended_at",
  "duration_seconds",
  "total_bytes",
  "verification",
]);
const DEVICE_IDENTITY_KEYS = new Set(["device_id", "device_label"]);
const VERIFICATION_KEYS = new Set([
  "actor",
  "validator",
  "manifest_sha256",
  "verified_at",
  "verdict",
  "diagnostics",
]);
const VALIDATOR_KEYS = new Set(["name", "version", "build_sha256"]);
const DISCOVERY_DIAGNOSTIC_KEYS = new Set([
  "quarantine_id",
  "code",
  "observed_at",
  "message",
]);
const VERIFICATION_DIAGNOSTIC_KEYS = new Set(["code", "summary"]);
const DISCOVERY_CODES = new Set<SessionListDiagnostic["code"]>([
  "manifest_unreadable",
  "unsupported_schema",
  "manifest_invalid",
  "manifest_not_sealed",
]);
const VERIFICATION_CODES = new Set([
  "artifact_digest_mismatch",
  "artifact_invalid",
  "manifest_invalid",
  "verification_failed",
]);

function hasExactKeys(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    Number.isFinite(Date.parse(value))
  );
}

function isNextCursor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isDeviceIdentity(value: unknown): boolean {
  return (
    hasExactKeys(value, DEVICE_IDENTITY_KEYS) &&
    typeof value.device_id === "string" &&
    UUID_V4.test(value.device_id) &&
    typeof value.device_label === "string" &&
    DEVICE_LABEL.test(value.device_label)
  );
}

function hasValidVerificationBase(value: Record<string, unknown>): boolean {
  const validator = value.validator;
  const verdict = value.verdict;
  return (
    value.actor === "gateway" &&
    hasExactKeys(validator, VALIDATOR_KEYS) &&
    isBoundedString(validator.name, 1, 128) &&
    isBoundedString(validator.version, 1, 64) &&
    typeof validator.build_sha256 === "string" &&
    SHA256.test(validator.build_sha256) &&
    typeof value.manifest_sha256 === "string" &&
    SHA256.test(value.manifest_sha256) &&
    isDateTime(value.verified_at) &&
    (verdict === "usable" || verdict === "unusable")
  );
}

function isLegacyVerification(value: unknown): value is LegacySessionVerification {
  if (!hasExactKeys(value, VERIFICATION_KEYS) || !hasValidVerificationBase(value)) {
    return false;
  }
  if (!Array.isArray(value.diagnostics)) {
    return false;
  }
  const diagnosticsValid = value.diagnostics.every((item) => isBoundedString(item, 1, 512));
  return diagnosticsValid && (value.verdict !== "unusable" || value.diagnostics.length > 0);
}

function isCurrentVerification(value: unknown): value is CurrentSessionVerification {
  if (!hasExactKeys(value, VERIFICATION_KEYS) || !hasValidVerificationBase(value)) {
    return false;
  }
  if (!Array.isArray(value.diagnostics)) {
    return false;
  }
  const diagnosticsValid = value.diagnostics.every(
    (item) =>
      hasExactKeys(item, VERIFICATION_DIAGNOSTIC_KEYS) &&
      typeof item.code === "string" &&
      VERIFICATION_CODES.has(item.code) &&
      isBoundedString(item.summary, 1, 512),
  );
  return diagnosticsValid && (value.verdict !== "unusable" || value.diagnostics.length > 0);
}

function isSummary(
  value: unknown,
  verification: (candidate: unknown) => boolean,
): value is SessionSummary {
  if (!hasExactKeys(value, SUMMARY_KEYS)) {
    return false;
  }
  return (
    typeof value.session_id === "string" &&
    UUID_V7.test(value.session_id) &&
    value.producer_outcome === "sealed" &&
    typeof value.take_id === "string" &&
    UUID_V7.test(value.take_id) &&
    Number.isSafeInteger(value.take_sequence) &&
    Number(value.take_sequence) >= 1 &&
    (value.continuation_of === null ||
      (typeof value.continuation_of === "string" && UUID_V7.test(value.continuation_of))) &&
    isBoundedString(value.display_name, 1, 160) &&
    isDeviceIdentity(value.device) &&
    isDateTime(value.started_at) &&
    isDateTime(value.ended_at) &&
    typeof value.duration_seconds === "number" &&
    Number.isFinite(value.duration_seconds) &&
    value.duration_seconds >= 0 &&
    Number.isSafeInteger(value.total_bytes) &&
    Number(value.total_bytes) >= 0 &&
    (value.verification === null || verification(value.verification))
  );
}

function isDiscoveryDiagnostic(value: unknown): value is SessionListDiagnostic {
  return (
    hasExactKeys(value, DISCOVERY_DIAGNOSTIC_KEYS) &&
    typeof value.quarantine_id === "string" &&
    UUID_V4.test(value.quarantine_id) &&
    typeof value.code === "string" &&
    DISCOVERY_CODES.has(value.code as SessionListDiagnostic["code"]) &&
    isDateTime(value.observed_at) &&
    isBoundedString(value.message, 1, 512)
  );
}

function hasValidCollections(
  value: Record<string, unknown>,
  verification: (candidate: unknown) => boolean,
): boolean {
  return (
    Array.isArray(value.items) &&
    value.items.every((item) => isSummary(item, verification)) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDiscoveryDiagnostic) &&
    isNextCursor(value.next_cursor)
  );
}

export function isSessionList(value: unknown): value is SessionList {
  if (hasExactKeys(value, LIST_V2_KEYS) && value.schema === "ylx.session-list.v2") {
    return hasValidCollections(value, isLegacyVerification);
  }
  if (
    hasExactKeys(value, LIST_V3_KEYS) &&
    value.schema === "ylx.session-list.v3" &&
    typeof value.catalog_revision === "string" &&
    CATALOG_REVISION.test(value.catalog_revision)
  ) {
    return hasValidCollections(value, isCurrentVerification);
  }
  return false;
}
