import { useEffect, useState } from "preact/hooks";

const MOBILE_QUERY = "(max-width: 859px), (max-width: 1200px) and (max-height: 600px) and (pointer: coarse)";

/** Include wide phones after rotation without changing desktop layouts. */
export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
