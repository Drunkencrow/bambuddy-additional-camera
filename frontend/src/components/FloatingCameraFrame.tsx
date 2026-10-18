import { useTranslation } from 'react-i18next';
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
  defaultSize = { width: 430, height: 320 },
  label,
}: {
  identity: string;
  storageKey: string;
  viewerIndex?: number;
  children: ReactNode;
  minimized?: boolean;
  defaultSize?: { width: number; height: number };
  label?: string;
}) {
  const { t } = useTranslation();
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
      x: window.innerWidth - defaultSize.width - 20 - viewerIndex * 30,
      y: 60 + viewerIndex * 30,
      ...defaultSize,
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
      aria-label={label ?? t('additionalCameras.overlay')}
      data-camera-overlay={identity}
      className="fixed z-40 rounded-lg shadow-2xl border border-bambu-dark-tertiary bg-bambu-dark-secondary overflow-hidden"
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
          aria-label={t('additionalCameras.resizeViewer')}
          aria-orientation="horizontal"
          className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize no-drag hover:bg-white/10 rounded-tl transition-colors touch-none"
          onPointerDown={(event) => {
            event.stopPropagation();
            begin(event, 'resize');
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 text-bambu-gray/70 hover:text-bambu-gray"
            aria-hidden="true"
          >
            <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22ZM22 10H20V8H22V10ZM18 14H16V12H18V14ZM14 18H12V16H14V18ZM10 22H8V20H10V22Z" />
          </svg>
        </div>
      )}
    </section>
  );
}
