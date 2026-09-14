import { useEffect, useState } from "preact/hooks";

/** Match the existing phone breakpoint, including rotation and resized windows. */
export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 859px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 859px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
