import type { AppState } from "../state/reducer";
import { NETWORK_MODE_LABELS, defaultRouteLabel, interfaceStatus } from "./format";

function statusText(state: AppState): string {
  if (!state.networkStatus) {
    return "网络状态不可用；配置修改未开放";
  }
  const operations = state.networkStatus.mutation_capability.operations.join(" / ") || "无操作";
  return `网络状态只读；配置修改未开放（${operations}）`;
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
  if (desired.wifi_client?.ssid) {
    parts.push(desired.wifi_client.ssid);
  }
  if (desired.wifi_client?.credential_state) {
    parts.push(desired.wifi_client.credential_state);
  }
  return parts.join(" / ");
}

function transactionText(state: AppState): string {
  const transaction = state.networkStatus?.transaction.current ?? state.networkStatus?.transaction.latest;
  if (!transaction) {
    return "无进行中事务";
  }
  return `${transaction.operation} / ${transaction.status} / ${transaction.stage} / ${transaction.transaction_id}`;
}

function mutationText(state: AppState): string {
  const capability = state.networkStatus?.mutation_capability;
  if (!capability) {
    return "不可用";
  }
  const availability = capability.enabled ? "可用" : "不可用";
  const idempotency = capability.idempotency_key_required ? "需要幂等键" : "不要求幂等键";
  const operations = capability.operations.join(" / ") || "无操作";
  return `${availability} / ${operations} / ${idempotency} / ${capability.secret_handling}`;
}

function concurrencyText(state: AppState): string {
  const capability = state.networkStatus?.concurrency_capability;
  if (!capability) {
    return "不可用";
  }
  const samePhy =
    capability.same_phy_ap_sta === "driver_advertised"
      ? "驱动声明支持"
      : capability.same_phy_ap_sta === "unsupported"
        ? "不支持"
        : capability.same_phy_ap_sta === "unverified"
          ? "未验证"
          : capability.same_phy_ap_sta;
  const rescue = capability.rescue_ap_required ? "需要 rescue AP" : "不要求 rescue AP";
  return `${samePhy} / ${rescue} / 失败超时 ${capability.exclusive_client_failure_timeout_seconds} 秒 / managed ${capability.max_managed_interfaces} / AP ${capability.max_ap_interfaces}`;
}

export function NetworkControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = state.networkStatus?.observed ?? runtime?.network ?? null;
  const mdns = state.networkStatus?.observed.mdns ?? null;

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
            {mdns
              ? `${mdns.hostname}:${mdns.port}`
              : "不可用"}
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

      <p id="network-status" class="panel-note">
        {statusText(state)}
      </p>
    </section>
  );
}
