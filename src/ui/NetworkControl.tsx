import type { AppState, NetworkMode } from "../state/reducer";
import { store } from "../state/store";
import {
  DEFAULT_ROUTE_LABELS,
  NETWORK_MODE_LABELS,
  connectionMethodLabel,
  defaultRouteLabel,
  interfaceStatus,
} from "./format";

const ACTIVE_STATES = new Set(["recording", "finalizing", "encoding", "verifying"]);

const MODES: NetworkMode[] = ["wifi-client", "hotspot", "ethernet-dhcp", "ethernet-static"];

/**
 * 断线后果由当前访问路径、默认路由、采集状态和 mDNS 坐标共同决定，
 * 必须在操作者确认之前逐条讲清楚——尤其是「关掉热点后本页可能无法自动恢复」。
 */
function riskText(state: AppState, mode: NetworkMode): string {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = runtime?.network ?? null;
  const method = runtime?.connection_method ?? null;
  const capabilities = state.networkStatus?.capabilities ?? null;
  const mdns = state.networkStatus?.mdns ?? null;
  const parts = [`即将应用「${NETWORK_MODE_LABELS[mode] ?? mode}」。`];
  if (method) {
    parts.push(`你当前经${connectionMethodLabel(method)}访问设备。`);
  }
  if (network) {
    parts.push(`默认路由 ${DEFAULT_ROUTE_LABELS[network.default_route] ?? network.default_route}。`);
  }
  if (method === "wifi_ap" && mode !== "hotspot" && capabilities?.second_wifi !== true) {
    parts.push("此操作会关闭设备热点，本页将断开且可能无法自动恢复。");
  } else {
    parts.push("链路切换期间本页可能断开。");
  }
  const deviceState = state.capture?.snapshot.device_state;
  if (deviceState && ACTIVE_STATES.has(deviceState)) {
    parts.push(
      "采集由 daemon 权威保持，不会因此中断；但链路断开后你将看不到收敛过程，也收不到安全换盘回执。",
    );
  }
  if (mdns) {
    const aliases = mdns.aliases.length > 0 ? `（别名 ${mdns.aliases.join("、")}）` : "";
    parts.push(`重连坐标：${mdns.hostname}:${mdns.port}${aliases}。`);
  }
  return parts.join("");
}

function resultRows(state: AppState): Array<[string, string]> {
  const result = state.networkResult;
  if (!result) {
    return [];
  }
  const rows: Array<[string, string]> = [["结果", result.ok ? "已应用" : "未生效"]];
  if (result.mode) {
    rows.push(["模式", NETWORK_MODE_LABELS[result.mode] ?? result.mode]);
  }
  if (typeof result.action === "string") {
    rows.push([
      "动作",
      result.action === "rescue" ? "rescue：配置未生效，设备已回退救援热点" : result.action,
    ]);
  }
  if (typeof result.recovery === "string") {
    rows.push(["恢复", result.recovery]);
  }
  if (typeof result.reason === "string") {
    rows.push(["原因", result.reason]);
  }
  if (typeof result.interrupted_phase === "string") {
    rows.push(["中断阶段", result.interrupted_phase]);
  }
  if (result.replayed === true) {
    rows.push(["幂等", "重放"]);
  }
  if (result.request_id) {
    rows.push(["request id", result.request_id]);
  }
  return rows;
}

function statusText(state: AppState): string {
  if (state.networkPending) {
    return "正在应用网络配置";
  }
  if (state.networkResult?.ok) {
    return `已应用 ${NETWORK_MODE_LABELS[state.networkResult.mode ?? ""] ?? "网络配置"}`;
  }
  if (state.device?.capabilities.network_mutation !== true) {
    return state.networkStatus
      ? "网络状态只读；配置修改未开放"
      : "网络状态不可用；配置修改未开放";
  }
  if (state.networkStatus) {
    const { wifi_interface, ethernet_interface } = state.networkStatus.capabilities;
    return `${wifi_interface} / ${ethernet_interface}`;
  }
  return "网络状态不可用";
}

export function NetworkControl({ state }: { state: AppState }) {
  const runtime = state.capture?.snapshot.runtime ?? state.device?.runtime ?? null;
  const network = runtime?.network ?? null;
  const writable = state.device?.capabilities.network_mutation === true;
  const editable = state.connection === "connected" && writable && !state.networkPending;
  const draft = state.networkDraft;
  const wifiMode = draft.mode === "wifi-client" || draft.mode === "hotspot";
  const staticMode = draft.mode === "ethernet-static";
  const rows = resultRows(state);

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
      </dl>

      {/* 能力不存在就不渲染写入口，只留一行事实——不做一个永远点不动的表单。 */}
      {writable ? (
        <form
          class="network-form"
          aria-label="网络设置"
          onSubmit={(event) => {
            event.preventDefault();
            void store.submitNetwork();
          }}
        >
          <fieldset class="segmented" disabled={!editable}>
            <legend class="eyebrow">模式</legend>
            {MODES.map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="mode"
                  value={mode}
                  checked={draft.mode === mode}
                  onChange={() => store.setNetworkDraft({ mode })}
                />
                <span>{NETWORK_MODE_LABELS[mode]}</span>
              </label>
            ))}
          </fieldset>

          {wifiMode ? (
            <div class="field-stack" data-network-fields="wifi">
              <label class="eyebrow" for="network-ssid">
                SSID
              </label>
              <input
                id="network-ssid"
                name="ssid"
                type="text"
                maxLength={32}
                autocomplete="off"
                required
                disabled={!editable}
                value={draft.ssid}
                onInput={(event) =>
                  store.setNetworkDraft({ ssid: (event.currentTarget as HTMLInputElement).value })
                }
              />
              <label class="eyebrow" for="network-psk">
                密码
              </label>
              <input
                id="network-psk"
                name="psk"
                type="password"
                minLength={8}
                maxLength={63}
                autocomplete="off"
                required
                disabled={!editable}
                value={draft.psk}
                onInput={(event) =>
                  store.setNetworkDraft({ psk: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </div>
          ) : null}

          {staticMode ? (
            <div class="field-stack" data-network-fields="static">
              <label class="eyebrow" for="network-address">
                IPv4 CIDR
              </label>
              <input
                id="network-address"
                name="address"
                type="text"
                autocomplete="off"
                required
                disabled={!editable}
                value={draft.address}
                onInput={(event) =>
                  store.setNetworkDraft({ address: (event.currentTarget as HTMLInputElement).value })
                }
              />
              <label class="eyebrow" for="network-gateway">
                网关
              </label>
              <input
                id="network-gateway"
                name="gateway"
                type="text"
                autocomplete="off"
                disabled={!editable}
                value={draft.gateway}
                onInput={(event) =>
                  store.setNetworkDraft({ gateway: (event.currentTarget as HTMLInputElement).value })
                }
              />
              <label class="eyebrow" for="network-dns">
                DNS
              </label>
              <input
                id="network-dns"
                name="dns"
                type="text"
                autocomplete="off"
                disabled={!editable}
                value={draft.dns}
                onInput={(event) =>
                  store.setNetworkDraft({ dns: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </div>
          ) : null}

          {state.networkArmed ? (
            <p class="network-risk" id="network-risk">
              {riskText(state, draft.mode)}
            </p>
          ) : null}

          <div class="chips">
            <button type="submit" class="command-button" id="network-command" disabled={!editable}>
              {state.networkPending ? "正在应用" : state.networkArmed ? "确认应用网络" : "应用网络"}
            </button>
            {state.networkArmed ? (
              <button
                type="button"
                class="command-button"
                id="network-cancel"
                onClick={() => store.disarmNetwork()}
              >
                取消
              </button>
            ) : null}
          </div>

          <p id="network-status" class="panel-note">
            {statusText(state)}
          </p>

          {rows.length > 0 ? (
            <dl class="facts" id="network-result">
              {rows.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </form>
      ) : (
        <p id="network-status" class="panel-note">
          {statusText(state)}
        </p>
      )}
    </section>
  );
}
