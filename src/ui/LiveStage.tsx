import { useEffect, useState } from "preact/hooks";
import { followLatestPreview, type PreviewState } from "../api/preview";
import type { AppState } from "../state/reducer";
import { Stage } from "./Stage";

/** Keep the frame cadence local to the viewfinder, outside the control panels. */
export function LiveStage({ state, controller }: { state: AppState; controller: AbortController | null }) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("waiting");

  useEffect(() => {
    if (!controller) return;
    let active = true;
    setFrameUrl(null);
    setPreviewState("waiting");
    void followLatestPreview({
      signal: controller.signal,
      onFrame: (url) => { if (active) setFrameUrl(url); },
      onState: (next) => { if (active) setPreviewState(next); },
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [controller]);

  return <Stage state={state} frameUrl={frameUrl} previewState={previewState} />;
}
