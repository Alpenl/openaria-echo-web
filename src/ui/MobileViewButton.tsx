import { useEffect, useState } from "preact/hooks";
import { ExpandIcon } from "./icons";

/** Fullscreen and orientation lock are optional; manual rotation always works. */
export function MobileViewButton() {
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [rotateHint, setRotateHint] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    const rotated = () => setRotateHint(false);
    const landscape = window.matchMedia("(orientation: landscape)");
    document.addEventListener("fullscreenchange", update);
    landscape.addEventListener("change", rotated);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      landscape.removeEventListener("change", rotated);
    };
  }, []);

  async function toggleView() {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* Browser may already be exiting. */ }
      return;
    }
    try {
      await document.documentElement.requestFullscreen?.();
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (value: "landscape") => Promise<void>;
      };
      if (document.fullscreenElement) await orientation?.lock?.("landscape");
    } catch { /* Browsers without orientation locking use manual rotation. */ }
    setRotateHint(!window.matchMedia("(orientation: landscape)").matches);
  }

  return (
    <>
      <button type="button" class="preview-view-toggle preview-tools-toggle icon-button"
        aria-label={fullscreen ? "退出全屏取景" : "横屏全屏取景"}
        onClick={() => void toggleView()}>
        <ExpandIcon size={18} />
        {fullscreen ? <span>退出全屏</span> : <span>横屏取景</span>}
      </button>
      {rotateHint ? <span class="rotate-hint" role="status">请将手机横放，画面会自动铺开</span> : null}
    </>
  );
}
