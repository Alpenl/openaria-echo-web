import type { AppState } from "../state/reducer";
import { store } from "../state/store";
import { CloseIcon } from "./icons";
import { NetworkControl } from "./NetworkControl";

export function NetworkPanel({ state }: { state: AppState }) {
  return (
    <aside id="network-panel" class="panel" aria-label="网络设置">
      <div class="panel-head">
        <span class="eyebrow">NETWORK</span>
        <span class="panel-title">网络设置</span>
        <span style="flex-grow:1" />
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
          onClick={() => {
            store.dispatch({ type: "panel.closed" });
            window.requestAnimationFrame(() =>
              document.getElementById("network-panel-trigger")?.focus(),
            );
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="panel-body">
        <NetworkControl state={state} />
      </div>
    </aside>
  );
}
