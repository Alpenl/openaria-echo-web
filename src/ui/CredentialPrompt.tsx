import { useState } from "preact/hooks";
import { setAccessToken } from "../api/client";
import { store } from "../state/store";

export function CredentialPrompt({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <div class="credential" role="dialog" aria-modal="true" aria-label="设备认证">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!token.trim() || pending) {
            return;
          }
          setPending(true);
          setAccessToken(token);
          void store.loadInitialState().then((ok) => {
            setPending(false);
            if (ok) {
              setToken("");
              onConnected();
            }
          });
        }}
      >
        <span class="eyebrow">设备访问令牌</span>
        <p style="color:var(--ink-2);text-wrap:pretty">
          这台设备运行在需要认证的 profile 下，使用产品能力前必须提供访问令牌。
        </p>
        <input
          type="password"
          autocomplete="off"
          spellcheck={false}
          required
          value={token}
          aria-label="设备访问令牌"
          onInput={(event) => setToken((event.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="command-button" disabled={pending || !token.trim()}>
          {pending ? "正在连接" : "连接设备"}
        </button>
      </form>
    </div>
  );
}
