import { useEffect, useRef, useState } from "preact/hooks";
import { followCaptureEvents, followNetworkEvents } from "./api/events";
import { followLatestPreview, type PreviewState } from "./api/preview";
import { visibleError } from "./state/store";
import { store } from "./state/store";
import { useEchoState } from "./state/useStore";
import { CommandBar } from "./ui/CommandBar";
import { CredentialPrompt } from "./ui/CredentialPrompt";
import { DevicePanel } from "./ui/DevicePanel";
import { Alerts, HazardBand } from "./ui/HazardBand";
import { NetworkPanel } from "./ui/NetworkPanel";
import { SessionsPanel } from "./ui/SessionsPanel";
import { Stage, StageOverlays } from "./ui/Stage";
import { TopBar } from "./ui/TopBar";

const CAPTURE_RECONCILE_INTERVAL_MS = 2000;
const PANEL_RECONCILE_INTERVAL_MS = 5000;

/**
 * 窄屏上并置双目每只眼只剩百来像素，等于放弃预览；所以窄屏默认单眼取景，
 * 宽屏默认双目。这只是首选值，用户随时可以在取景控件里改。
 */
function initialInspect(): "both" | "left" {
  return window.matchMedia("(min-width: 860px)").matches ? "both" : "left";
}

export function App() {
  const state = useEchoState();
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("waiting");
  const started = useRef(false);
  const eventController = useRef<AbortController | null>(null);
  const networkEventController = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);

  useEffect(() => {
    store.dispatch({ type: "inspect.changed", mode: initialInspect() });
  }, []);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    let captureReconcileTimer: number | null = null;
    let panelReconcileTimer: number | null = null;

    const reconcileCapture = () => {
      if (!document.hidden) {
        void store.reconcileCapture();
      }
    };
    const reconcilePanel = () => {
      if (!document.hidden) {
        void store.refreshOpenPanel();
      }
    };
    const reconcileVisibleState = () => {
      reconcileCapture();
      reconcilePanel();
    };
    const followVisibility = () => {
      if (!document.hidden) {
        reconcileVisibleState();
      }
    };
    const startReconciliation = () => {
      if (captureReconcileTimer !== null) {
        return;
      }
      captureReconcileTimer = window.setInterval(
        reconcileCapture,
        CAPTURE_RECONCILE_INTERVAL_MS,
      );
      panelReconcileTimer = window.setInterval(reconcilePanel, PANEL_RECONCILE_INTERVAL_MS);
      window.addEventListener("focus", reconcileVisibleState);
      window.addEventListener("online", reconcileVisibleState);
      document.addEventListener("visibilitychange", followVisibility);
    };
    void store.loadInitialState().then((ok) => {
      if (ok) {
        startLiveConnections();
        startReconciliation();
      }
    });

    function startLiveConnections() {
      const handleUnauthorized = (error: Parameters<typeof visibleError>[0]) => {
        eventController.current?.abort();
        eventController.current = null;
        networkEventController.current?.abort();
        networkEventController.current = null;
        previewController.current?.abort();
        previewController.current = null;
        store.dispatch({ type: "credentials.required" });
        store.dispatch({ type: "connection.failed", error: visibleError(error) });
      };
      if (!eventController.current) {
        const controller = new AbortController();
        eventController.current = controller;
        void followCaptureEvents({
          signal: controller.signal,
          onEvent: store.acceptCaptureEvent,
          onConnection: (connection) => store.dispatch({ type: "connection.changed", connection }),
          onUnauthorized: (error) => {
            handleUnauthorized(error);
          },
        });
      }
      if (!networkEventController.current) {
        const controller = new AbortController();
        networkEventController.current = controller;
        void followNetworkEvents({
          signal: controller.signal,
          onEvent: store.acceptNetworkEvent,
          onUnauthorized: handleUnauthorized,
        });
      }
      if (!previewController.current && store.getState().device?.capabilities.preview) {
        const controller = new AbortController();
        previewController.current = controller;
        void followLatestPreview({
          signal: controller.signal,
          onFrame: setFrameUrl,
          onState: setPreviewState,
        });
      }
    }

    const stop = () => {
      eventController.current?.abort();
      networkEventController.current?.abort();
      previewController.current?.abort();
    };
    window.addEventListener("pagehide", stop, { once: true });
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("focus", reconcileVisibleState);
      window.removeEventListener("online", reconcileVisibleState);
      document.removeEventListener("visibilitychange", followVisibility);
      if (captureReconcileTimer !== null) {
        window.clearInterval(captureReconcileTimer);
      }
      if (panelReconcileTimer !== null) {
        window.clearInterval(panelReconcileTimer);
      }
      stop();
    };
  }, []);

  return (
    <div class="echo">
      <Stage state={state} frameUrl={frameUrl} previewState={previewState} />
      <TopBar state={state} />
      <div class="stage-mid">
        <HazardBand state={state} />
        <Alerts state={state} />
        <StageOverlays state={state} />
      </div>
      <CommandBar state={state} />
      {state.panel === "sessions" ? <SessionsPanel state={state} /> : null}
      {state.panel === "device" ? <DevicePanel state={state} /> : null}
      {state.panel === "network" ? <NetworkPanel state={state} /> : null}
      {state.needsCredentials ? (
        <CredentialPrompt
          onConnected={() => {
            started.current = false;
            window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
