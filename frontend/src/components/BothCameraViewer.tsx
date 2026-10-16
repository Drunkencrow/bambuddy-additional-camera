import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Maximize, Minimize } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useCameraStreamAccess } from '../hooks/useCameraStreamToken';
import { cameraViewerIdentity } from '../utils/cameraIdentity';
import { PrimaryCameraPane } from './PrimaryCameraPane';
import { AdditionalCameraPane } from './AdditionalCameraViewer';
import './bothCamera.css';

interface Props {
  printerId: number;
  windowMode?: boolean;
  minimized?: boolean;
  headerActions?: ReactNode;
}

/** Admission checks configuration once; subsequent feed failures never gate siblings. */
export function BothCameraViewer(props: Props) {
  const { loading, authEnabled, user, hasPermission } = useAuth();
  if (loading || (authEnabled && (!user || !hasPermission('camera:view')))) return null;
  return <ConfiguredBothCameraViewer key={props.printerId} {...props} />;
}

function ConfiguredBothCameraViewer({ printerId, windowMode = false, minimized = false, headerActions }: Props) {
  const { t } = useTranslation();
  const access = useCameraStreamAccess();
  const valid = Number.isSafeInteger(printerId) && printerId > 0;
  const [admitted, setAdmitted] = useState(false);
  const status = useQuery({
    queryKey: ['additional-camera-viewer-status', cameraViewerIdentity('additional', printerId), access.token],
    queryFn: () => api.getAdditionalCameraStatus(printerId, access.token),
    enabled: valid && access.ready && !admitted,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (status.data?.configured && status.data.enabled) setAdmitted(true);
  }, [status.data]);
  const { data: printer } = useQuery({
    queryKey: ['printer', printerId],
    queryFn: () => api.getPrinter(printerId),
    enabled: valid && access.ready,
  });
  const title = `${printer?.name || `Printer ${printerId}`} — ${t('camera.bothCameras', 'Both Cameras')}`;
  const root = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!windowMode) return;
    document.title = title;
    return () => {
      document.title = 'Bambuddy';
    };
  }, [title, windowMode]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {});
    else void root.current?.requestFullscreen?.().catch(() => {});
  };
  return (
    <div
      ref={root}
      data-camera-viewer={cameraViewerIdentity('both', printerId)}
      className="both-camera-root h-full min-h-0 min-w-0 bg-black text-white flex flex-col overflow-hidden"
    >
      <div
        data-camera-drag-handle={windowMode ? undefined : true}
        className="flex items-center justify-between gap-2 px-3 py-2 bg-bambu-dark border-b border-bambu-dark-tertiary shrink-0 cursor-grab"
        style={{ touchAction: 'none' }}
      >
        <h1 className="text-sm font-medium min-w-0 truncate" title={title}>
          {title}
        </h1>
        <div className="flex items-center gap-1 no-drag shrink-0">
          {!minimized && (
            <button
              className="p-1.5 rounded hover:bg-bambu-dark-tertiary"
              onClick={toggleFullscreen}
              title={fullscreen ? t('camera.exitFullscreen') : t('camera.fullscreen')}
            >
              {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          )}
          {headerActions}
        </div>
      </div>
      {!minimized &&
        (admitted ? (
          <div className="both-camera-panes flex-1 min-h-0 min-w-0">
            <PrimaryCameraPane
              printerId={printerId}
              presentation={windowMode ? 'window-pane' : 'embedded-pane'}
              fullscreen={fullscreen}
            />
            <AdditionalCameraPane printerId={printerId} />
          </div>
        ) : (
          <div role="status" className="flex-1 flex items-center justify-center p-4 text-sm text-bambu-gray">
            {!valid || access.unavailable || status.isError || status.data
              ? t('camera.cameraUnavailable')
              : t('camera.connectingToCamera')}
          </div>
        ))}
    </div>
  );
}
