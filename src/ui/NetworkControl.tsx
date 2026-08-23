import type { AppState } from "../state/reducer";
import { NETWORK_MODE_LABELS, defaultRouteLabel, interfaceStatus } from "./format";

function statusText(state: AppState): string {
  if (!state.networkStatus) {
    return "网络状态不可用；配置修改未开放";
  }
  const { wifi_interface, ethernet_interface } = state.networkStatus.capabilities;
  return `网络状态只读；配置修改未开放（${wifi_interface} / ${ethernet_interface}）`;
}

function modeList(state: AppState): string {
  const modes = state.networkStatus?.capabilities.modes ?? [];
  return modes.map((mode) => NETWORK_MODE_LABELS[mode] ?? mode).join(" / ") || "不可用";
}

export function NetworkControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = runtime?.network ?? null;

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
          <dd data-testid="network-mdns" data-tone={state.networkStatus?.mdns ? undefined : "caution"}>
            {state.networkStatus?.mdns
              ? `${state.networkStatus.mdns.hostname}:${state.networkStatus.mdns.port}`
              : "不可用"}
          </dd>
        </div>
        <div>
          <dt>支持模式</dt>
          <dd data-testid="network-modes">{modeList(state)}</dd>
        </div>
      </dl>

      <p id="network-status" class="panel-note">
        {statusText(state)}
      </p>
    </section>
  );
}
