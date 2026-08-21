import { useState } from "preact/hooks";
import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import {
  connectionMethodLabel,
  formatBytes,
  formatCelsius,
  formatClock,
  interfaceStatus,
} from "./format";
import { CloseIcon } from "./icons";

function FocusControl({ state }: { state: AppState }) {
  const focus = state.capture?.snapshot.runtime.camera_focus ?? state.device?.runtime.camera_focus;
  const [draft, setDraft] = useState<number | null>(null);

  // 能力不存在就不渲染控件，只留一行事实——不做一个永远点不动的表单。
  if (!focus) {
    return (
      <section class="detail-section">
        <span class="eyebrow">OPTICS</span>
        <dl class="facts">
          <div>
            <dt>手动焦距</dt>
            <dd data-testid="camera-focus-value" data-tone="caution">
              不可用
            </dd>
          </div>
        </dl>
        <p style="font-size:12px;color:var(--ink-3);text-wrap:pretty">
          当前相机未暴露 V4L2 focus_absolute / focus_auto，设备也没有声明焦距能力。
        </p>
      </section>
    );
  }

  const value = draft ?? focus.value;
  return (
    <section class="detail-section">
      <span class="eyebrow">OPTICS</span>
      <dl class="facts">
        <div>
          <dt>手动焦距</dt>
          <dd data-testid="camera-focus-value">{focus.value}</dd>
        </div>
      </dl>
      <input
        type="range"
        min={focus.minimum}
        max={focus.maximum}
        step={focus.step}
        value={value}
        disabled={state.focusPending || focus.auto_enabled === true}
        aria-label="手动焦距"
        onInput={(event) => setDraft(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <div class="chips">
        <button
          type="button"
          class="chip"
          disabled={state.focusPending || draft === null}
          onClick={() => {
            if (draft !== null) {
              void store.setCameraFocus({ value: draft });
              setDraft(null);
            }
          }}
        >
          应用焦距
        </button>
        {focus.auto_supported ? (
          <button
            type="button"
            class="chip"
            aria-pressed={focus.auto_enabled === true}
            disabled={state.focusPending}
            onClick={() => void store.setCameraFocus({ auto_enabled: !focus.auto_enabled })}
          >
            自动对焦
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function DevicePanel({ state }: { state: AppState }) {
  const device = state.device;
  const runtime = state.capture?.snapshot.runtime ?? device?.runtime ?? null;
  const network = runtime?.network ?? null;
  const receipt = state.safeSwapReceipt?.receipt ?? null;

  return (
    <aside class="panel" aria-label="设备与链路">
      <div class="panel-head">
        <span class="eyebrow">DEVICE</span>
        <span class="panel-title">设备与链路</span>
        <span style="flex-grow:1" />
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
          onClick={() => store.dispatch({ type: "panel.closed" })}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="panel-body">
        {receipt ? (
          <section class="detail-section" style="border-left:3px solid var(--permit)">
            <span class="eyebrow">MEDIA RELEASE</span>
            <h3>可以移除存储设备</h3>
            <dl class="facts">
              <div>
                <dt>释放结果</dt>
                <dd data-testid="safe-swap-release" data-tone="permit">
                  {receipt.release_state}
                </dd>
              </div>
              <div>
                <dt>会话</dt>
                <dd data-testid="safe-swap-session">{receipt.session_id}</dd>
              </div>
              <div>
                <dt>句柄数</dt>
                <dd data-tone="permit">{receipt.open_handle_count}</dd>
              </div>
              <div>
                <dt>密封于</dt>
                <dd>{formatClock(receipt.sealed_at)}</dd>
              </div>
              <div>
                <dt>释放于</dt>
                <dd>{formatClock(receipt.released_at)}</dd>
              </div>
              <div>
                <dt>manifest sha256</dt>
                <dd class="artifact-hash">{receipt.manifest_sha256}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section class="detail-section">
          <span class="eyebrow">RUNTIME</span>
          <dl class="facts">
            <div>
              <dt>温度</dt>
              <dd>{formatCelsius(runtime?.temperature_celsius)}</dd>
            </div>
            <div>
              <dt>连接方式</dt>
              <dd>{connectionMethodLabel(runtime?.connection_method)}</dd>
            </div>
            <div>
              <dt>默认路由</dt>
              <dd data-testid="network-default-route">
                {connectionMethodLabel(network?.default_route)}
              </dd>
            </div>
            <div>
              <dt>观测于</dt>
              <dd data-tone="muted">{formatClock(runtime?.observed_at)}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <span class="eyebrow">NETWORK</span>
          <dl class="facts">
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
              <dd
                data-testid="network-mdns"
                data-tone={state.networkStatus?.mdns ? undefined : "caution"}
              >
                {state.networkStatus?.mdns
                  ? `${state.networkStatus.mdns.hostname}:${state.networkStatus.mdns.port}`
                  : "不可用"}
              </dd>
            </div>
          </dl>
          <p style="font-size:12px;color:var(--ink-3);text-wrap:pretty">
            {device?.capabilities.network_mutation
              ? "设备空闲且已授权时才可写入网络配置。"
              : "本机的安全 profile 不开放网络写入，因此这里只投影事实，不渲染写入口。"}
          </p>
        </section>

        <FocusControl state={state} />

        <section class="detail-section">
          <span class="eyebrow">STORAGE</span>
          <dl class="facts">
            <div>
              <dt>剩余</dt>
              <dd>{formatBytes(device?.storage.available_bytes)}</dd>
            </div>
            <div>
              <dt>总量</dt>
              <dd data-tone="muted">{formatBytes(device?.storage.total_bytes)}</dd>
            </div>
            <div>
              <dt>可写</dt>
              <dd data-tone={device?.storage.writable ? undefined : "caution"}>
                {device?.storage.writable ? "是" : "否"}
              </dd>
            </div>
            <div>
              <dt>volume</dt>
              <dd>{device?.storage.volume_id ?? "--"}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <span class="eyebrow">BUILD &amp; AUTHORITY</span>
          <dl class="facts">
            <div>
              <dt>软件包</dt>
              <dd>{device?.build?.package_version ?? "--"}</dd>
            </div>
            <div>
              <dt>Device API</dt>
              <dd>{device?.api_version ?? "--"}</dd>
            </div>
            <div>
              <dt>安全 profile</dt>
              <dd>{device?.security_profile ?? "--"}</dd>
            </div>
            <div>
              <dt>build id</dt>
              <dd>{device?.build?.build_id ?? "--"}</dd>
            </div>
            <div>
              <dt>commit</dt>
              <dd class="artifact-hash">{device?.build?.commit ?? "--"}</dd>
            </div>
            <div>
              <dt>硬件指纹</dt>
              <dd class="artifact-hash">{device?.hardware_fingerprint ?? "--"}</dd>
            </div>
            <div>
              <dt>authority epoch</dt>
              <dd class="artifact-hash">{state.capture?.authority_epoch ?? "--"}</dd>
            </div>
            <div>
              <dt>source revision</dt>
              <dd>{state.capture?.source_revision ?? "--"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
