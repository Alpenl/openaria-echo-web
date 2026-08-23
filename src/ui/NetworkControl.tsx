import { useEffect, useRef, useState } from "preact/hooks";
import type { NetworkScanEntry, NetworkWifiSecurity } from "../api/types";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { NETWORK_MODE_LABELS, defaultRouteLabel, interfaceStatus } from "./format";
import { RefreshIcon } from "./icons";

const SECURITY_LABELS: Record<NetworkWifiSecurity, string> = {
  open: "开放网络",
  "wpa2-personal": "WPA2 Personal",
  "wpa3-personal": "WPA3 Personal",
  "wpa2-wpa3-personal": "WPA2 / WPA3",
};

const DISABLED_REASON_LABELS: Record<string, string> = {
  not_enabled: "未启用",
  auth_profile_unavailable: "当前鉴权配置不允许变更",
  controller_unavailable: "控制器不可用",
  network_manager_unavailable: "NetworkManager 不可用",
  rescue_ap_not_validated: "救援热点尚未验证",
  capture_active: "录制期间不可变更",
  recovery_required: "需要先完成网络恢复",
  maintenance_window_closed: "维护窗口已关闭",
  unsupported_concurrency: "无线并发能力不支持",
};

const RECOVERY_LABELS: Record<string, string> = {
  await_device: "等待设备",
  reconnect_target_lan: "连接目标网络",
  reconnect_rescue_ap: "连接救援热点",
  retry: "可重试",
  service_required: "需要现场处理",
  none: "无",
};

const STAGE_PROGRESS: Record<string, number> = {
  accepted: 1,
  prepared: 2,
  ap_ready: 3,
  activating: 4,
  verifying: 5,
  committed: 6,
  falling_back: 4,
  rescued: 6,
  failed: 6,
  forgetting: 4,
  forgotten: 6,
};

function statusText(state: AppState): string {
  const capability = state.networkStatus?.mutation_capability;
  if (!capability) {
    return "网络状态不可用";
  }
  if (capability.enabled) {
    return state.networkStatus?.verified ? "已保存并验证当前 Wi-Fi" : "网络变更可用";
  }
  return DISABLED_REASON_LABELS[capability.disabled_reason ?? "not_enabled"] ?? "网络变更不可用";
}

function modeList(state: AppState): string {
  const mode = state.networkStatus?.desired.mode;
  return mode ? (NETWORK_MODE_LABELS[mode] ?? mode) : "不可用";
}

function desiredText(state: AppState): string {
  const desired = state.networkStatus?.desired;
  if (!desired) {
    return "不可用";
  }
  const parts = [NETWORK_MODE_LABELS[desired.mode] ?? desired.mode];
  if (desired.wifi_client) {
    parts.push(desired.wifi_client.ssid, SECURITY_LABELS[desired.wifi_client.security]);
    parts.push(desired.wifi_client.credential_state);
  }
  return parts.join(" / ");
}

function transactionText(state: AppState): string {
  const transaction =
    state.networkStatus?.transaction.current ?? state.networkStatus?.transaction.latest;
  if (!transaction) {
    return "无网络事务";
  }
  const recovery = RECOVERY_LABELS[transaction.recovery_action] ?? transaction.recovery_action;
  return `${transaction.operation} / ${transaction.status} / ${transaction.stage} / ${recovery}`;
}

function mutationText(state: AppState): string {
  const capability = state.networkStatus?.mutation_capability;
  if (!capability) {
    return "不可用";
  }
  const availability = capability.enabled
    ? "可用"
    : (DISABLED_REASON_LABELS[capability.disabled_reason ?? "not_enabled"] ?? "不可用");
  return `${availability} / ${capability.operations.join(" / ")} / 需要幂等键`;
}

function concurrencyText(state: AppState): string {
  const capability = state.networkStatus?.concurrency_capability;
  if (!capability) {
    return "不可用";
  }
  const samePhy =
    capability.same_phy_ap_sta === "supported"
      ? "已验证支持"
      : capability.same_phy_ap_sta === "unsupported"
        ? "不支持"
        : "未验证";
  return `${samePhy} / 故障回退 ${capability.exclusive_client_failure_timeout_seconds} 秒 / managed ${capability.max_managed_interfaces} / AP ${capability.max_ap_interfaces}`;
}

function currentTransaction(state: AppState) {
  return state.networkStatus?.transaction.current ?? state.networkStatus?.transaction.latest ?? null;
}

function visibleNetworks(state: AppState): NetworkScanEntry[] {
  return (state.networkScan?.networks ?? [])
    .filter(
      (network): network is NetworkScanEntry & { ssid: string } =>
        !network.hidden && network.ssid !== null,
    )
    .sort((left, right) => right.signal_dbm - left.signal_dbm);
}

function selectedNetwork(state: AppState, selection: string): NetworkScanEntry | null {
  if (!selection.startsWith("scan:")) {
    return null;
  }
  const index = Number(selection.slice(5));
  return Number.isSafeInteger(index) ? (visibleNetworks(state)[index] ?? null) : null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function NetworkProvisioning({ state }: { state: AppState }) {
  const [selection, setSelection] = useState("manual");
  const [manualSsid, setManualSsid] = useState("");
  const [manualSecurity, setManualSecurity] =
    useState<NetworkWifiSecurity>("wpa2-personal");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState<"apply" | "forget" | null>(null);
  const applyTriggerRef = useRef<HTMLButtonElement>(null);
  const forgetTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (state.networkScan === null) {
      void store.scanNetworks();
    }
  }, []);

  useEffect(() => {
    if (confirmation === null) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => confirmationCancelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const trigger = confirmationTriggerRef.current;
      confirmationTriggerRef.current = null;
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) {
          trigger.focus();
        }
      });
    };
  }, [confirmation]);

  const scanned = selectedNetwork(state, selection);
  const ssid = scanned?.ssid ?? manualSsid;
  const security = scanned?.security ?? manualSecurity;
  const requiresPassphrase = security !== "open";
  const commandBusy = ["submitting", "accepted"].includes(state.networkCommand.phase);
  const capability = state.networkStatus?.mutation_capability;
  const canMutate = capability?.enabled === true && !commandBusy;
  const ssidValid = utf8Length(ssid) >= 1 && utf8Length(ssid) <= 32;
  const passphraseBytes = utf8Length(passphrase);
  const passphraseValid = !requiresPassphrase || (passphraseBytes >= 8 && passphraseBytes <= 63);
  const canApply = canMutate && ssidValid && passphraseValid;
  const applyTriggerFocusable =
    canApply || (commandBusy && state.networkCommand.operation === "apply");
  const forgetting = commandBusy && state.networkCommand.operation === "forget";
  const forgetTriggerFocusable = canMutate || forgetting;
  const showForgetAction = state.networkStatus?.saved === true || forgetting;
  const transaction = currentTransaction(state);
  const retryable =
    transaction !== null &&
    ["rescued", "failed"].includes(transaction.status) &&
    transaction.error?.retryable === true;

  const apply = () => {
    if (!canApply) {
      return;
    }
    const submittedPassphrase = requiresPassphrase ? passphrase : undefined;
    setPassphrase("");
    setConfirmation(null);
    void store.applyWifiNetwork({ ssid, security, passphrase: submittedPassphrase });
  };

  return (
    <section class="network-provisioning" aria-labelledby="network-provisioning-title">
      <div class="network-section-head">
        <h3 id="network-provisioning-title">Wi-Fi 配置</h3>
        <button
          type="button"
          class="icon-button compact"
          aria-label="扫描 Wi-Fi"
          title="扫描 Wi-Fi"
          disabled={state.networkScanPending || commandBusy}
          onClick={() => void store.scanNetworks()}
        >
          <RefreshIcon size={17} />
        </button>
      </div>

      <form
        class="network-form"
        aria-label="网络设置"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApply) {
            confirmationTriggerRef.current = applyTriggerRef.current;
            setConfirmation("apply");
          }
        }}
      >
        <label class="field-stack">
          <span>Wi-Fi 网络</span>
          <select
            aria-label="Wi-Fi 网络"
            value={selection}
            disabled={!canMutate}
            onChange={(event) => {
              setSelection((event.currentTarget as HTMLSelectElement).value);
              setPassphrase("");
            }}
          >
            <option value="manual">手动输入 SSID</option>
            {visibleNetworks(state).map((network, index) => (
              <option value={`scan:${index}`} key={`${network.ssid}:${network.security}`}>
                {network.ssid} · {SECURITY_LABELS[network.security]} · {network.signal_dbm} dBm
              </option>
            ))}
          </select>
        </label>

        {scanned === null ? (
          <>
            <label class="field-stack">
              <span>SSID</span>
              <input
                type="text"
                name="ssid"
                aria-label="SSID"
                maxLength={32}
                value={manualSsid}
                disabled={!canMutate}
                onInput={(event) =>
                  setManualSsid((event.currentTarget as HTMLInputElement).value)
                }
              />
            </label>
            <label class="field-stack">
              <span>安全类型</span>
              <select
                aria-label="安全类型"
                value={manualSecurity}
                disabled={!canMutate}
                onChange={(event) => {
                  setManualSecurity(
                    (event.currentTarget as HTMLSelectElement).value as NetworkWifiSecurity,
                  );
                  setPassphrase("");
                }}
              >
                {Object.entries(SECURITY_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {requiresPassphrase ? (
          <label class="field-stack">
            <span>Wi-Fi 密码</span>
            <input
              type="password"
              name="network-passphrase"
              aria-label="Wi-Fi 密码"
              autoComplete="new-password"
              minLength={8}
              maxLength={63}
              value={passphrase}
              disabled={!canMutate}
              onInput={(event) =>
                setPassphrase((event.currentTarget as HTMLInputElement).value)
              }
            />
          </label>
        ) : null}

        <button
          ref={applyTriggerRef}
          type="submit"
          class="panel-command"
          disabled={!applyTriggerFocusable}
          aria-disabled={!canApply}
        >
          {state.networkCommand.operation === "apply" && commandBusy ? "正在切换" : "应用网络"}
        </button>
      </form>

      {confirmation === "apply" ? (
        <div
          class="network-confirm"
          role="alertdialog"
          aria-labelledby="network-apply-confirm-title"
          aria-describedby="network-apply-confirm-description"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setConfirmation(null);
            }
          }}
        >
          <strong id="network-apply-confirm-title">切换到 {ssid}</strong>
          <p id="network-apply-confirm-description">当前管理连接可能短暂中断。</p>
          <div class="network-confirm-actions">
            <button type="button" class="panel-command" onClick={apply}>
              确认切换
            </button>
            <button
              ref={confirmationCancelRef}
              type="button"
              class="panel-secondary"
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div class="network-actions">
        {retryable ? (
          <button
            type="button"
            class="panel-secondary"
            disabled={!canMutate}
            onClick={() => void store.retryNetwork(transaction.transaction_id)}
          >
            重试事务
          </button>
        ) : null}
        {showForgetAction ? (
          <button
            ref={forgetTriggerRef}
            type="button"
            class="panel-danger"
            disabled={!forgetTriggerFocusable}
            aria-disabled={!canMutate}
            onClick={() => {
              if (canMutate) {
                confirmationTriggerRef.current = forgetTriggerRef.current;
                setConfirmation("forget");
              }
            }}
          >
            {forgetting ? "正在忘记" : "忘记 Wi-Fi"}
          </button>
        ) : null}
      </div>

      {confirmation === "forget" ? (
        <div
          class="network-confirm danger"
          role="alertdialog"
          aria-labelledby="network-forget-title"
          aria-describedby="network-forget-description"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setConfirmation(null);
            }
          }}
        >
          <strong id="network-forget-title">忘记已保存的 Wi-Fi</strong>
          <p id="network-forget-description">设备将回到救援热点。</p>
          <div class="network-confirm-actions">
            <button
              type="button"
              class="panel-danger"
              onClick={() => {
                setConfirmation(null);
                void store.forgetNetwork();
              }}
            >
              确认忘记
            </button>
            <button
              ref={confirmationCancelRef}
              type="button"
              class="panel-secondary"
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {transaction ? (
        <div class="network-progress" aria-live="polite">
          <progress max={6} value={STAGE_PROGRESS[transaction.stage] ?? 0} />
          <span>{transactionText(state)}</span>
          {transaction.deadline ? (
            <span>{transaction.deadline.remaining_seconds.toFixed(1)} 秒</span>
          ) : null}
        </div>
      ) : null}

      {state.networkCommand.phase === "indeterminate" ? (
        <p class="network-risk" role="status">
          事务结果待确认；连接恢复后以设备状态为准。
        </p>
      ) : null}
    </section>
  );
}

export function NetworkControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = state.networkStatus?.observed ?? runtime?.network ?? null;
  const mdns = state.networkStatus?.observed.mdns ?? null;
  const capability = state.networkStatus?.mutation_capability;

  return (
    <section class="detail-section">
      <span class="eyebrow">NETWORK</span>
      <dl class="facts">
        <div>
          <dt>默认路由</dt>
          <dd data-testid="network-default-route">{defaultRouteLabel(network?.default_route)}</dd>
        </div>
        <div>
          <dt>热点 AP</dt>
          <dd data-testid="network-ap">{interfaceStatus(network?.ap)}</dd>
        </div>
        <div>
          <dt>Wi-Fi</dt>
          <dd data-testid="network-wifi">{interfaceStatus(network?.wifi_client)}</dd>
        </div>
        <div>
          <dt>有线</dt>
          <dd data-testid="network-wired">{interfaceStatus(network?.wired)}</dd>
        </div>
        <div>
          <dt>mDNS</dt>
          <dd data-testid="network-mdns" data-tone={mdns ? undefined : "caution"}>
            {mdns ? `${mdns.hostname}:${mdns.port}` : "不可用"}
          </dd>
        </div>
        <div>
          <dt>目标模式</dt>
          <dd data-testid="network-modes">{modeList(state)}</dd>
        </div>
        <div>
          <dt>目标状态</dt>
          <dd data-testid="network-desired">{desiredText(state)}</dd>
        </div>
        <div>
          <dt>事务</dt>
          <dd data-testid="network-transaction">{transactionText(state)}</dd>
        </div>
        <div>
          <dt>变更能力</dt>
          <dd data-testid="network-mutation">{mutationText(state)}</dd>
        </div>
        <div>
          <dt>并发边界</dt>
          <dd data-testid="network-concurrency">{concurrencyText(state)}</dd>
        </div>
      </dl>

      <p id="network-status" class="panel-note" aria-live="polite">
        {statusText(state)}
      </p>

      {capability?.enabled ? <NetworkProvisioning state={state} /> : null}
    </section>
  );
}
