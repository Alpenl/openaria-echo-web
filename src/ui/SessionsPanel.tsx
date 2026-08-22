import type { AppState, SessionFilter } from "../state/reducer";
import { store } from "../state/store";
import type { SessionSummary } from "../api/types";
import { formatGiB, formatSeconds, verdictLabel } from "./format";
import { CloseIcon, RefreshIcon, SearchIcon } from "./icons";
import { SessionDetail } from "./SessionDetail";

const FILTERS: Array<{ id: SessionFilter; label: string; tone?: "caution" }> = [
  { id: "all", label: "全部" },
  { id: "usable", label: "已验证可用" },
  { id: "unsuccessful", label: "未成功", tone: "caution" },
];

function verdictOf(session: SessionSummary): "usable" | "unusable" | "unknown" {
  if (session.producer_outcome !== "sealed") {
    return "unknown";
  }
  return session.verification?.verdict ?? "unknown";
}

function matches(session: SessionSummary, query: string, filter: SessionFilter): boolean {
  if (filter === "usable" && verdictOf(session) !== "usable") {
    return false;
  }
  if (filter === "unsuccessful" && session.producer_outcome === "sealed") {
    return false;
  }
  if (!query) {
    return true;
  }
  const needle = query.trim().toLowerCase();
  return (
    session.display_name.toLowerCase().includes(needle) ||
    session.session_id.toLowerCase().includes(needle)
  );
}

export function SessionsPanel({ state }: { state: AppState }) {
  if (state.selected) {
    return <SessionDetail state={state} />;
  }

  const { items, query, filter, loading, loadedOnce, nextCursor, diagnostics } = state.sessions;
  const visible = items.filter((session) => matches(session, query, filter));

  return (
    <aside class="panel" aria-label="会话台账">
      <div class="panel-head">
        <span class="eyebrow">SESSIONS</span>
        <span class="panel-title">会话台账</span>
        <span style="flex-grow:1" />
        <button
          type="button"
          class="icon-button"
          aria-label="刷新会话"
          title="刷新会话"
          disabled={loading}
          onClick={() => void store.refreshSessions()}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
          onClick={() => store.dispatch({ type: "panel.closed" })}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="panel-tools">
        <div class="search">
          <SearchIcon size={15} />
          <input
            type="search"
            value={query}
            placeholder="搜索会话名或 ID"
            aria-label="搜索会话"
            onInput={(event) =>
              store.setSessionQuery((event.currentTarget as HTMLInputElement).value)
            }
          />
        </div>
        <div class="chips">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              class="chip"
              data-tone={option.tone}
              aria-pressed={filter === option.id}
              onClick={() => store.setSessionFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
          <span class="chip" aria-hidden="true" style="border-color:transparent;color:var(--ink-3)">
            已载入 {items.length}
          </span>
        </div>
      </div>

      <div class="panel-body">
        {visible.map((session) => (
          <button
            key={session.session_id}
            type="button"
            class="session-row"
            data-testid="session-item"
            data-outcome={session.producer_outcome === "sealed" ? "sealed" : "unsuccessful"}
            onClick={() => void store.openSession(session.session_id, session.producer_outcome)}
          >
            <span class="session-head">
              <span class="session-name">{session.display_name}</span>
              {/* 生产方声明与消费方判断分开投影，绝不合并成一个「状态」。 */}
              <span class="verdict" data-verdict={verdictOf(session)}>
                {verdictLabel(session.verification?.verdict)}
              </span>
            </span>
            <span class="session-meta">
              <span>{formatSeconds(session.duration_seconds)}</span>
              <span>{formatGiB(session.total_bytes)}</span>
              <span class="producer">
                {session.producer_outcome === "sealed" ? "已封存" : session.producer_outcome}
              </span>
              <code class="session-uuid">{session.session_id}</code>
            </span>
          </button>
        ))}

        {diagnostics.map((diagnostic) => (
          <p class="discovery-diagnostic" key={`msg-${diagnostic.quarantine_id}`} title={diagnostic.code}>
            {diagnostic.message}
          </p>
        ))}

        {visible.length === 0 && loadedOnce && !loading && diagnostics.length === 0 ? (
          <p class="panel-empty">
            {items.length === 0 ? "暂无会话" : "没有匹配当前搜索或筛选的会话"}
          </p>
        ) : null}
        {!loadedOnce ? <p class="panel-empty">会话列表尚未加载</p> : null}

        {nextCursor ? (
          <button
            type="button"
            class="panel-more"
            disabled={loading}
            onClick={() => void store.loadMoreSessions()}
          >
            {loading ? "正在读取" : "加载更多"}
          </button>
        ) : loadedOnce && items.length > 0 ? (
          <p class="panel-empty">已到台账末尾</p>
        ) : null}
      </div>
    </aside>
  );
}
