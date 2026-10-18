import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Camera, Fullscreen, GripVertical, Maximize, Minimize, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useAdditionalCameraStream } from '../hooks/useAdditionalCameraStream';
import { useCameraViewport } from '../hooks/useCameraViewport';
import { cameraViewerPresentation as presentation } from './cameraViewerPresentation';
import { cameraViewerIdentity } from '../utils/cameraIdentity';

interface Props {
  printerId: number;
  windowMode?: boolean;
  headerActions?: ReactNode;
  minimized?: boolean;
  pane?: boolean;
}

/** Shared Additional presentation for popup and overlay, independent of printer controls. */
export function AdditionalCameraViewer({ printerId, windowMode = false, headerActions, minimized = false, pane = false }: Props) {
  const { t } = useTranslation();
  const stream = useAdditionalCameraStream(printerId);
  const { url, phase, loaded, retry } = stream;
  const title = stream.friendlyName?.trim() || t('additionalCameras.viewerTitle', 'Additional Camera');
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewport = useCameraViewport(containerRef);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!windowMode || pane) return;
    document.title = `${title} - Camera`;
    return () => {
      document.title = 'Bambuddy';
    };
  }, [title, windowMode, pane]);

  useEffect(() => {
    const image = imgRef.current;
    const disconnect = () => image?.removeAttribute('src');
    window.addEventListener('pagehide', disconnect);
    window.addEventListener('beforeunload', disconnect);
    return () => {
      disconnect();
      window.removeEventListener('pagehide', disconnect);
      window.removeEventListener('beforeunload', disconnect);
    };
  }, [url]);

  useEffect(() => {
    // Some browsers expose MJPEG dimensions before firing a load event.
    if (phase !== 'loading') return;
    const probe = setInterval(() => {
      if (imgRef.current && imgRef.current.naturalWidth > 0) loaded();
    }, 500);
    return () => clearInterval(probe);
  }, [url, phase, loaded]);

  useEffect(() => {
    // pagehide closes the request even when the browser caches the page. A
    // history restore must request a new session rather than reuse that image.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) retry();
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [retry]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === containerRef.current) void document.exitFullscreen().catch(() => {});
    else void containerRef.current?.requestFullscreen?.().catch(() => {});
  };
  const compact = !windowMode && !pane;
  const buttonClass = compact ? presentation.embeddedButton : presentation.windowButton;
  const iconClass = compact ? presentation.embeddedIcon : presentation.windowIcon;

  return (
    <div
      ref={containerRef}
      data-camera-viewer={pane ? undefined : cameraViewerIdentity('additional', printerId)}
      data-camera-pane={pane ? 'additional' : undefined}
      className="h-full min-w-0 min-h-0 bg-black flex flex-col text-white overflow-hidden"
    >
      <div
        data-camera-drag-handle={pane || windowMode ? undefined : true}
        className={
          pane ? presentation.paneHeader : windowMode ? presentation.windowHeader : presentation.embeddedHeader
        }
        style={{ touchAction: 'none' }}
      >
        <h1 className={`${compact ? "" : "font-medium "}text-sm text-white flex items-center gap-2 min-w-0 truncate`} title={title}>
          {compact ? <GripVertical className="w-4 h-4 text-bambu-gray shrink-0" /> : <Camera className="w-4 h-4 shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        <div
          className={
            pane ? 'flex flex-wrap items-center gap-1 no-drag' : `flex items-center ${windowMode ? 'gap-2' : 'gap-1'} no-drag shrink-0`
          }
        >
          {!minimized && (
            <>
              <div className="flex bg-bambu-dark rounded p-0.5">
                <button
                  className={`${compact ? "px-2 py-0" : "px-3 py-1"} text-xs rounded transition-colors ${stream.mode === 'stream' ? 'bg-bambu-green text-white' : 'text-bambu-gray hover:text-white'}`}
                  onClick={() => stream.switchMode('stream')}
                  aria-pressed={stream.mode === 'stream'}
                >
                  {t('camera.live', 'Live')}
                </button>
                <button
                  className={`${compact ? "px-2 py-0" : "px-3 py-1"} text-xs rounded transition-colors ${stream.mode === 'snapshot' ? 'bg-bambu-green text-white' : 'text-bambu-gray hover:text-white'}`}
                  onClick={() => stream.switchMode('snapshot')}
                  aria-pressed={stream.mode === 'snapshot'}
                >
                  {t('camera.snapshot', 'Snapshot')}
                </button>
              </div>
              <button
                className={buttonClass}
                onClick={stream.retry}
                title={
                  stream.mode === 'stream'
                    ? t('camera.restartStream', 'Restart stream')
                    : t('camera.refreshSnapshot', 'Refresh snapshot')
                }
              >
                <RefreshCw className={iconClass} />
              </button>
              {!pane && <button
                className={buttonClass}
                onClick={toggleFullscreen}
                title={
                  fullscreen ? t('camera.exitFullscreen', 'Exit fullscreen') : t('camera.fullscreen', 'Fullscreen')
                }
              >
                {fullscreen ? <Minimize className={iconClass} /> : compact ? <Fullscreen className={iconClass} /> : <Maximize className={iconClass} />}
              </button>}
            </>
          )}
          {headerActions}
        </div>
      </div>
      {!minimized && (
        <div
          className={`relative flex-1 min-h-0 flex items-center justify-center overflow-hidden ${compact ? "" : "p-2"}`}
          onWheel={viewport.handleWheel}
          onMouseMove={viewport.handleImageMouseMove}
          onMouseUp={viewport.handleImageMouseUp}
          onMouseLeave={viewport.handleImageMouseUp}
          onTouchStart={viewport.handleTouchStart}
          onTouchMove={viewport.handleTouchMove}
          onTouchEnd={viewport.handleTouchEnd}
          style={{ touchAction: 'none' }}
        >
          {stream.url && (
            <img
              data-camera-token-managed
              key={stream.url}
              ref={imgRef}
              src={stream.url}
              alt={t('camera.cameraStream', 'Camera stream')}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              onLoad={stream.loaded}
              onError={stream.failed}
              onMouseDown={viewport.handleImageMouseDown}
              // Phase 2 rotates both stream and snapshot server-side using the
              // Additional configuration. Applying printer rotation here is wrong.
              style={{
                transform: `scale(${viewport.zoomLevel}) translate(${viewport.panOffset.x / viewport.zoomLevel}px, ${viewport.panOffset.y / viewport.zoomLevel}px)`,
                cursor: viewport.zoomLevel > 1 ? (viewport.isPanning ? 'grabbing' : 'grab') : 'default',
              }}
            />
          )}
          {stream.phase === 'loading' && (
            <div role="status" className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <RefreshCw className={`${compact ? "w-6 h-6" : "w-8 h-8"} text-bambu-gray animate-spin`} />
              <p className={compact ? "sr-only" : "text-sm text-bambu-gray"}>{t('camera.connectingToCamera', 'Connecting to camera...')}</p>
            </div>
          )}
          {(stream.phase === 'unavailable' || stream.phase === 'reconnecting') && (
            <div
              role="alert"
              className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 p-4"
            >
              <AlertTriangle className="w-8 h-8 text-orange-400" />
              <p>{t('camera.cameraUnavailable', 'Camera unavailable')}</p>
              {stream.phase === 'reconnecting' && (
                <p role="status" className="text-sm text-bambu-gray">
                  {t('camera.connectionLost', 'Connection lost')} — {t('common.reconnecting', 'Reconnecting...')}
                </p>
              )}
              <button onClick={stream.retry} className="px-4 py-2 bg-bambu-green rounded hover:bg-bambu-green/80">
                {t('camera.retry', 'Retry')}
              </button>
            </div>
          )}
          <div className={`absolute flex items-center bg-black/60 no-drag ${compact ? "bottom-2 left-2 gap-1 rounded px-1.5 py-1" : "bottom-6 left-6 gap-1.5 rounded-lg px-2 py-1.5"}`}>
            <button
              className={`${compact ? "p-1" : "p-1.5"} hover:bg-white/10 rounded disabled:opacity-30`}
              onClick={viewport.handleZoomOut}
              disabled={viewport.zoomLevel <= 1}
              title={t('camera.zoomOut', 'Zoom out')}
            >
              <ZoomOut className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} text-white`} />
            </button>
            <button className={`${compact ? "px-1.5 py-0.5 text-xs min-w-[32px]" : "px-2 py-1 text-sm min-w-[48px]"} text-white hover:bg-white/10 rounded`} onClick={viewport.resetZoom} title={t('camera.resetZoom', 'Reset zoom')}>
              {Math.round(viewport.zoomLevel * 100)}%
            </button>
            <button
              className={`${compact ? "p-1" : "p-1.5"} hover:bg-white/10 rounded disabled:opacity-30`}
              onClick={viewport.handleZoomIn}
              disabled={viewport.zoomLevel >= 4}
              title={t('camera.zoomIn', 'Zoom in')}
            >
              <ZoomIn className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} text-white`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Additional feed only: no floating frame, document title, or fullscreen control. */
export function AdditionalCameraPane({ printerId }: { printerId: number }) {
  return <AdditionalCameraViewer printerId={printerId} pane />;
}
