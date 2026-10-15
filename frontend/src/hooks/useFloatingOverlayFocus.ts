import { useCallback, useEffect, useSyncExternalStore } from 'react';

// Session-only MRU order, keyed by viewer identity. No geometry, persistence,
// or transport state belongs here. Removing a viewer restores the prior owner.
let viewers: string[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getActive = () => viewers.at(-1);

export function useFloatingOverlayFocus(identity: string) {
  const active = useSyncExternalStore(subscribe, getActive, getActive);
  useEffect(() => {
    viewers = [...viewers.filter((viewer) => viewer !== identity), identity];
    notify();
    return () => {
      viewers = viewers.filter((viewer) => viewer !== identity);
      notify();
    };
  }, [identity]);

  const bringToFront = useCallback(() => {
    if (getActive() === identity) return;
    viewers = [...viewers.filter((viewer) => viewer !== identity), identity];
    notify();
  }, [identity]);

  return {
    // Two bounded layers keep camera overlays below the existing modal layer.
    zIndex: active === identity ? 41 : 40,
    onPointerDownCapture: bringToFront,
    onMouseDownCapture: bringToFront,
    onTouchStartCapture: bringToFront,
    onClickCapture: bringToFront,
    onFocusCapture: bringToFront,
  };
}
