import { useEffect, useRef, useState } from "preact/hooks";
import type {
  NetworkScanEntry,
  NetworkTransaction,
  NetworkWifiSecurity,
} from "../api/types";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { defaultRouteLabel, interfaceStatus } from "./format";
import { RefreshIcon } from "./icons";

const SECURITY_LABELS: Record<NetworkWifiSecurity, string> = {
  open: "开放网络",
  "wpa2-personal": "WPA2 Personal",
  "wpa3-personal": "WPA3 Personal",
  "wpa2-wpa3-personal": "WPA2 / WPA3",
};

const SECURITY_SHORT_LABELS: Record<NetworkWifiSecurity, string> = {
  open: "开放",
  "wpa2-personal": "WPA2",
  "wpa3-personal": "WPA3",
  "wpa2-wpa3-personal": "WPA2 / WPA3",
};

const DISABLED_REASON_LABELS: Record<string, string> = {
  not_enabled: "网络修改未启用",
  auth_profile_unavailable: "当前配置不允许修改网络",
  controller_unavailable: "网络控制器不可用",
  network_manager_unavailable: "NetworkManager 不可用",
  rescue_ap_not_validated: "设备热点尚未验证",
  capture_active: "录制期间不可修改网络",
  recovery_required: "需要先完成网络恢复",
  maintenance_window_closed: "网络维护窗口已关闭",
  unsupported_concurrency: "无线硬件不支持当前模式",
};

const STAGE_LABELS: Record<NetworkTransaction["stage"], string> = {
  accepted: "请求已接收",
  prepared: "正在准备",
  ap_ready: "设备热点已就绪",
  activating: "正在连接",
  verifying: "正在验证连接",
  committed: "连接完成",
  falling_back: "正在恢复网络",
  rescued: "已恢复到设备热点",
  failed: "连接失败",
  forgetting: "正在忘记网络",
  forgotten: "已忘记网络",
};

const OPERATION_LABELS: Record<NetworkTransaction["operation"], string> = {
  apply: "切换网络",
  retry: "重试连接",
  forget: "忘记网络",
};

const ERROR_LABELS: Record<NonNullable<NetworkTransaction["error"]>["code"], string> = {
  rescue_ap_unavailable: "设备热点不可用",
  credential_rejected: "密码可能不正确",
  dhcp_timeout: "未能获取网络地址",
  route_lost: "网络路由已断开",
  network_manager_unavailable: "NetworkManager 不可用",
  concurrency_unsupported: "无线硬件不支持同时切换",
};

const COLLAPSED_NETWORK_COUNT = 6;

function networkStatusText(state: AppState): string {
  const status = state.networkStatus;
  const capability = status?.mutation_capability;
  if (!capability) {
    return "网络状态不可用";
  }
  if (!capability.enabled) {
    return (
      DISABLED_REASON_LABELS[capability.disabled_reason ?? "not_enabled"] ?? "网络修改不可用"
    );
  }
  const transaction = status.transaction.current ?? status.transaction.latest;
  const hotspotValidated =
    status.desired.mode === "hotspot" &&
    transaction?.desired.mode === "hotspot" &&
    transaction.status === "committed" &&
    transaction.rescue.ap_validated;
  if (hotspotValidated) {
    return "热点配置已验证";
  }
  if (status.verified) {
    return "配置已保存并验证";
  }
  return "网络修改可用";
}

function transactionForDisplay(state: AppState): NetworkTransaction | null {
  const current = state.networkStatus?.transaction.current;
  if (current) {
    return current;
  }
  const latest = state.networkStatus?.transaction.latest;
  return latest && ["rescued", "failed"].includes(latest.status) ? latest : null;
}

function networkKey(network: NetworkScanEntry & { ssid: string }): string {
  return JSON.stringify([network.ssid, network.security]);
}

function visibleNetworks(state: AppState): Array<NetworkScanEntry & { ssid: string }> {
  const strongestByNetwork = new Map<string, NetworkScanEntry & { ssid: string }>();
  for (const network of state.networkScan?.networks ?? []) {
    if (network.hidden || network.ssid === null) {
      continue;
    }
    const candidate = network as NetworkScanEntry & { ssid: string };
    const key = networkKey(candidate);
    const existing = strongestByNetwork.get(key);
    if (!existing || candidate.signal_dbm > existing.signal_dbm) {
      strongestByNetwork.set(key, candidate);
    }
  }
  return [...strongestByNetwork.values()].sort(
    (left, right) => right.signal_dbm - left.signal_dbm,
  );
}

function selectedNetwork(
  state: AppState,
  selection: string,
): (NetworkScanEntry & { ssid: string }) | null {
  if (!selection.startsWith("scan:")) {
    return null;
  }
  const key = selection.slice(5);
  return visibleNetworks(state).find((network) => networkKey(network) === key) ?? null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function signalQuality(signalDbm: number): { level: number; label: string } {
  if (signalDbm >= -55) {
    return { level: 4, label: "强" };
  }
  if (signalDbm >= -67) {
    return { level: 3, label: "良好" };
  }
  if (signalDbm >= -75) {
    return { level: 2, label: "一般" };
  }
  return { level: 1, label: "弱" };
}

function SignalMeter({ signalDbm }: { signalDbm: number }) {
  const quality = signalQuality(signalDbm);
  return (
    <span class="wifi-signal" role="img" aria-label={`信号${quality.label}`}>
      <span class="wifi-signal-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <i data-active={level <= quality.level} key={level} />
        ))}
      </span>
      <span>{quality.label}</span>
    </span>
  );
}

function currentConnection(state: AppState): {
  name: string;
  kind: string;
  address: string | null;
  connected: boolean;
} {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = state.networkStatus?.observed ?? runtime?.network ?? null;
  if (!network) {
    return { name: "网络状态不可用", kind: "网络", address: null, connected: false };
  }

  const wifiConnected = network.wifi_client.state === "connected";
  const wiredConnected = network.wired.state === "connected";
  const hotspotActive = ["active", "connected"].includes(network.ap.state);
  const desiredWifi =
    state.networkStatus?.desired.mode === "wifi-client"
      ? state.networkStatus.desired.wifi_client
      : null;

  if (network.default_route === "wifi_client" && wifiConnected) {
    return {
      name: network.wifi_client.peer_or_ssid ?? desiredWifi?.ssid ?? "Wi-Fi",
      kind: "Wi-Fi",
      address: network.wifi_client.addresses[0] ?? null,
      connected: true,
    };
  }
  if (network.default_route === "wired" && wiredConnected) {
    return {
      name: "有线网络",
      kind: "以太网",
      address: network.wired.addresses[0] ?? null,
      connected: true,
    };
  }
  if (wifiConnected) {
    return {
      name: network.wifi_client.peer_or_ssid ?? desiredWifi?.ssid ?? "Wi-Fi",
      kind: "Wi-Fi",
      address: network.wifi_client.addresses[0] ?? null,
      connected: true,
    };
  }
  if (hotspotActive) {
    return {
      name: network.ap.peer_or_ssid ?? "设备热点",
      kind: "设备热点",
      address: network.ap.addresses[0] ?? null,
      connected: true,
    };
  }
  if (wiredConnected) {
    return {
      name: "有线网络",
      kind: "以太网",
      address: network.wired.addresses[0] ?? null,
      connected: true,
    };
  }
  return { name: "未连接", kind: "网络", address: null, connected: false };
}

function isCurrentWifi(state: AppState, network: NetworkScanEntry & { ssid: string }): boolean {
  const observed = state.networkStatus?.observed;
  const desired = state.networkStatus?.desired;
  if (observed?.wifi_client.state !== "connected") {
    return false;
  }
  const currentSsid =
    observed.wifi_client.peer_or_ssid ??
    (desired?.mode === "wifi-client" ? desired.wifi_client?.ssid : null);
  return currentSsid === network.ssid;
}

function NetworkProvisioning({ state }: { state: AppState }) {
  const [selection, setSelection] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [manualSsid, setManualSsid] = useState("");
  const [manualSecurity, setManualSecurity] =
    useState<NetworkWifiSecurity>("wpa2-personal");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState<"apply" | "hotspot" | "forget" | null>(null);
  const [submittedApplyMode, setSubmittedApplyMode] = useState<
    "wifi-client" | "hotspot" | null
  >(null);
  const applyTriggerRef = useRef<HTMLButtonElement>(null);
  const hotspotTriggerRef = useRef<HTMLButtonElement>(null);
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

  const networks = visibleNetworks(state);
  const displayedNetworks = showAll ? networks : networks.slice(0, COLLAPSED_NETWORK_COUNT);
  const scanned = selectedNetwork(state, selection);
  const manualSelected = selection === "manual";
  const networkSelected = scanned !== null || manualSelected;
  const ssid = scanned?.ssid ?? (manualSelected ? manualSsid : "");
  const security = scanned?.security ?? manualSecurity;
  const requiresPassphrase = networkSelected && security !== "open";
  const commandBusy = ["submitting", "accepted"].includes(state.networkCommand.phase);
  const capability = state.networkStatus?.mutation_capability;
  const canMutate = capability?.enabled === true && !commandBusy;
  const ssidValid = utf8Length(ssid) >= 1 && utf8Length(ssid) <= 32;
  const passphraseBytes = utf8Length(passphrase);
  const passphraseValid = !requiresPassphrase || (passphraseBytes >= 8 && passphraseBytes <= 63);
  const canApply = canMutate && networkSelected && ssidValid && passphraseValid;
  const applying = commandBusy && state.networkCommand.operation === "apply";
  const applyingWifi = applying && submittedApplyMode !== "hotspot";
  const applyingHotspot = applying && submittedApplyMode === "hotspot";
  const applyTriggerFocusable = canApply || applyingWifi;
  const canSwitchHotspot = canMutate && state.networkStatus?.desired.mode !== "hotspot";
  const hotspotTriggerFocusable = canSwitchHotspot || applyingHotspot;
  const forgetting = commandBusy && state.networkCommand.operation === "forget";
  const forgetTriggerFocusable = canMutate || forgetting;
  const showForgetAction = state.networkStatus?.saved === true || forgetting;

  const chooseNetwork = (nextSelection: string) => {
    setSelection(nextSelection);
    setPassphrase("");
  };

  const apply = () => {
    if (!canApply) {
      return;
    }
    const submittedPassphrase = requiresPassphrase ? passphrase : undefined;
    setPassphrase("");
    setSubmittedApplyMode("wifi-client");
    setConfirmation(null);
    void store.applyWifiNetwork({ ssid, security, passphrase: submittedPassphrase });
  };

  const applyHotspot = () => {
    if (!canSwitchHotspot) {
      return;
    }
    setSubmittedApplyMode("hotspot");
    setConfirmation(null);
    void store.applyHotspot();
  };

  return (
    <section class="network-provisioning" aria-labelledby="available-networks-title">
      <div class="network-section-head">
        <div>
          <h3 id="available-networks-title">可用网络</h3>
          <span aria-live="polite">
            {state.networkScanPending
              ? "正在扫描"
              : state.networkScan
                ? `${networks.length} 个`
                : "尚未扫描"}
          </span>
        </div>
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
        <div class="wifi-network-list" aria-label="Wi-Fi 网络" aria-busy={state.networkScanPending}>
          {displayedNetworks.map((network) => {
            const key = networkKey(network);
            const selected = selection === `scan:${key}`;
            const current = isCurrentWifi(state, network);
            return (
              <button
                type="button"
                class="wifi-network-option"
                data-testid="wifi-network-option"
                data-current={current}
                aria-pressed={selected}
                onClick={() => chooseNetwork(`scan:${key}`)}
                key={key}
              >
                <span class="wifi-network-identity">
                  <strong>{network.ssid}</strong>
                  <span>{SECURITY_SHORT_LABELS[network.security]}</span>
                </span>
                <span class="wifi-network-meta">
                  {current ? <span class="wifi-current-tag">当前</span> : null}
                  <SignalMeter signalDbm={network.signal_dbm} />
                </span>
              </button>
            );
          })}

          {state.networkScan && networks.length === 0 ? (
            <p class="wifi-network-empty">未发现可用 Wi-Fi</p>
          ) : null}

          <button
            type="button"
            class="wifi-network-option wifi-network-manual"
            aria-pressed={manualSelected}
            onClick={() => chooseNetwork("manual")}
          >
            <span aria-hidden="true">+</span>
            <span>手动添加网络</span>
          </button>
        </div>

        {networks.length > COLLAPSED_NETWORK_COUNT ? (
          <button
            type="button"
            class="network-list-toggle"
            aria-expanded={showAll}
            onClick={() => setShowAll((visible) => !visible)}
          >
            {showAll ? "收起" : `显示其他 ${networks.length - COLLAPSED_NETWORK_COUNT} 个网络`}
          </button>
        ) : null}

        {networkSelected ? (
          <div class="network-selection-fields">
            {manualSelected ? (
              <>
                <label class="field-stack">
                  <span>网络名称</span>
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
              {applyingWifi ? "正在连接" : "连接"}
            </button>
          </div>
        ) : null}
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
        <button
          ref={hotspotTriggerRef}
          type="button"
          class="panel-secondary"
          disabled={!hotspotTriggerFocusable}
          aria-disabled={!canSwitchHotspot}
          onClick={() => {
            if (canSwitchHotspot) {
              confirmationTriggerRef.current = hotspotTriggerRef.current;
              setConfirmation("hotspot");
            }
          }}
        >
          {applyingHotspot
            ? "正在启用热点"
            : state.networkStatus?.desired.mode === "hotspot"
              ? "设备热点已启用"
              : "启用设备热点"}
        </button>
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

      {confirmation === "hotspot" ? (
        <div
          class="network-confirm"
          role="alertdialog"
          aria-labelledby="network-hotspot-title"
          aria-describedby="network-hotspot-description"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setConfirmation(null);
            }
          }}
        >
          <strong id="network-hotspot-title">启用设备热点</strong>
          <p id="network-hotspot-description">当前管理连接可能中断。</p>
          <div class="network-confirm-actions">
            <button type="button" class="panel-command" onClick={applyHotspot}>
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
    </section>
  );
}

function NetworkTransactionFeedback({ state }: { state: AppState }) {
  const transaction = transactionForDisplay(state);
  if (!transaction) {
    return null;
  }
  const commandBusy = ["submitting", "accepted"].includes(state.networkCommand.phase);
  const canRetry =
    state.networkStatus?.mutation_capability.enabled === true &&
    !commandBusy &&
    ["rescued", "failed"].includes(transaction.status) &&
    transaction.error?.retryable === true;

  return (
    <section class="network-progress" data-status={transaction.status} aria-live="polite">
      <progress max={6} value={STAGE_PROGRESS[transaction.stage] ?? 0} />
      <div>
        <strong data-testid="network-transaction">{STAGE_LABELS[transaction.stage]}</strong>
        <span>{OPERATION_LABELS[transaction.operation]}</span>
      </div>
      {transaction.deadline ? (
        <span>{transaction.deadline.remaining_seconds.toFixed(1)} 秒</span>
      ) : null}
      {transaction.error ? (
        <p class="network-progress-error">{ERROR_LABELS[transaction.error.code]}</p>
      ) : null}
      {canRetry ? (
        <button
          type="button"
          class="panel-secondary"
          onClick={() => void store.retryNetwork(transaction.transaction_id)}
        >
          重试连接
        </button>
      ) : null}
    </section>
  );
}

const STAGE_PROGRESS: Record<NetworkTransaction["stage"], number> = {
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

export function NetworkControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = state.networkStatus?.observed ?? runtime?.network ?? null;
  const mdns = state.networkStatus?.observed.mdns ?? null;
  const capability = state.networkStatus?.mutation_capability;
  const current = currentConnection(state);

  return (
    <section class="network-view">
      <header class="network-current" data-connected={current.connected}>
        <div class="network-current-topline">
          <span>当前连接</span>
          <span>{current.connected ? "已连接" : "未连接"}</span>
        </div>
        <strong data-testid="network-current-name">{current.name}</strong>
        <div class="network-current-meta">
          <span>{current.kind}</span>
          {current.address ? <span data-testid="network-current-address">{current.address}</span> : null}
        </div>
        <p id="network-status" data-tone={capability?.enabled ? "normal" : "caution"}>
          {networkStatusText(state)}
        </p>
      </header>

      {capability?.enabled ? <NetworkProvisioning state={state} /> : null}

      <NetworkTransactionFeedback state={state} />

      <details class="network-details">
        <summary>网络详情</summary>
        <dl>
          <div>
            <dt>默认连接</dt>
            <dd data-testid="network-default-route">
              {defaultRouteLabel(network?.default_route)}
            </dd>
          </div>
          <div>
            <dt>Wi-Fi</dt>
            <dd data-testid="network-wifi">{interfaceStatus(network?.wifi_client)}</dd>
          </div>
          <div>
            <dt>设备热点</dt>
            <dd data-testid="network-ap">{interfaceStatus(network?.ap)}</dd>
          </div>
          <div>
            <dt>有线</dt>
            <dd data-testid="network-wired">{interfaceStatus(network?.wired)}</dd>
          </div>
          <div>
            <dt>本机地址</dt>
            <dd data-testid="network-mdns" data-tone={mdns ? undefined : "caution"}>
              {mdns ? `${mdns.hostname}:${mdns.port}` : "不可用"}
            </dd>
          </div>
        </dl>
      </details>

      {state.networkCommand.phase === "indeterminate" ? (
        <p class="network-risk" role="status">
          连接结果待确认；恢复连接后以设备状态为准。
        </p>
      ) : null}
    </section>
  );
}
