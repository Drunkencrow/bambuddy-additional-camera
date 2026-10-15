import { useFloatingOverlayFocus } from '../hooks/useFloatingOverlayFocus';
import { cameraOverlaySize } from './cameraOverlaySize';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Presentation shell only; owns geometry but no transport or printer state. */
export function FloatingCameraFrame({
  identity,
  storageKey,
  viewerIndex = 0,
  children,
  minimized = false,
}: {
  identity: string;
  storageKey: string;
  viewerIndex?: number;
  children: ReactNode;
  minimized?: boolean;
}) {
  const { zIndex, ...focusHandlers } = useFloatingOverlayFocus(identity);
  const clamp = (value: Geometry): Geometry => ({
    x: Math.max(0, Math.min(value.x, window.innerWidth - 100)),
    y: Math.max(0, Math.min(value.y, window.innerHeight - 100)),
    width: Math.max(200, Math.min(value.width, window.innerWidth - 20)),
    height: Math.max(150, Math.min(value.height, window.innerHeight - 20)),
  });
  const [geometry, setGeometry] = useState<Geometry>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (
        saved &&
        ['x', 'y', 'width', 'height'].every((key) =>
          Number.isFinite(saved[key]),
        )
      )
        return clamp(saved);
    } catch {
      /* Fall back to on-screen defaults. */
    }
    return clamp({
      x: window.innerWidth - 450 - viewerIndex * 30,
      y: 60 + viewerIndex * 30,
      width: 430,
      height: 320,
    });
  });
  const gesture = useRef<{
    mode: 'drag' | 'resize';
    x: number;
    y: number;
    initial: Geometry;
  } | null>(null);

  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(geometry));
      } catch {
        /* Session geometry still works. */
      }
    };
    const timer = setTimeout(save, 500);
    return () => {
      clearTimeout(timer);
      save();
    };
  }, [geometry, storageKey]);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const active = gesture.current;
      if (!active) return;
      event.preventDefault();
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      const { initial } = active;
      setGeometry(
        active.mode === 'drag'
          ? {
              ...initial,
              x: Math.max(
                0,
                Math.min(initial.x + dx, window.innerWidth - initial.width),
              ),
              y: Math.max(
                0,
                Math.min(initial.y + dy, window.innerHeight - initial.height),
              ),
            }
          : {
              ...initial,
              width: Math.max(
                200,
                Math.min(
                  initial.width + dx,
                  window.innerWidth - initial.x - 10,
                ),
              ),
              height: Math.max(
                150,
                Math.min(
                  initial.height + dy,
                  window.innerHeight - initial.y - 10,
                ),
              ),
            },
      );
    };
    const end = () => {
      gesture.current = null;
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
    };
  }, []);

  const begin = (event: PointerEvent, mode: 'drag' | 'resize') => {
    if (event.button !== 0) return;
    event.preventDefault();
    gesture.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      initial: geometry,
    };
  };

  return (
    <section
      {...focusHandlers}
      aria-label="Additional Camera overlay"
      data-camera-overlay={identity}
      className="fixed z-40 rounded-lg shadow-2xl border border-bambu-dark-tertiary bg-black overflow-hidden"
      style={{
        zIndex,
        left: geometry.x,
        top: geometry.y,
        ...cameraOverlaySize(minimized, geometry),
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('[data-camera-drag-handle]') &&
          !target.closest('.no-drag')
        )
          begin(event, 'drag');
      }}
    >
      {children}
      {!minimized && (
        <div
          role="separator"
          aria-label="Resize camera viewer"
          aria-orientation="horizontal"
          className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize touch-none"
          onPointerDown={(event) => {
            event.stopPropagation();
            begin(event, 'resize');
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="w-4 h-4 text-bambu-gray"
            aria-hidden="true"
          >
            <path d="M4 14L14 4M9 14L14 9" stroke="currentColor" />
          </svg>
        </div>
      )}
    </section>
  );
}
