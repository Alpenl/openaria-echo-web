import { useEffect, useState } from "preact/hooks";
import { store } from "./store";
import type { AppState } from "./reducer";

export function useEchoState(): AppState {
  const [state, setState] = useState<AppState>(store.getState());
  useEffect(() => store.subscribe(() => setState(store.getState())), []);
  return state;
}
