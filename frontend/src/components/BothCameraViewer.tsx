import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, Fullscreen, GripVertical, Maximize, Minimize } from 'lucide-react';
import { ApiError, api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useCameraStreamAccess } from '../hooks/useCameraStreamToken';
import { cameraViewerIdentity } from '../utils/cameraIdentity';
import { PrimaryCameraPane } from './PrimaryCameraPane';
import { AdditionalCameraPane } from './AdditionalCameraViewer';
import './bothCamera.css';
import { cameraViewerPresentation as presentation } from './cameraViewerPresentation';

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
  const [admitted, setAdmitted] = useState<{ token?: string } | null>(null);
  const status = useQuery({
    queryKey: ['additional-camera-viewer-status', cameraViewerIdentity('additional', printerId), access.token],
    queryFn: () => api.getAdditionalCameraStatus(printerId, access.token),
    enabled: valid && access.ready && !admitted,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!admitted && status.data?.configured && status.data.enabled) setAdmitted({ token: access.token });
  }, [admitted, status.data, access.token]);
  const { data: printer } = useQuery({
    queryKey: ['printer', printerId],
    queryFn: () => api.getPrinter(printerId),
    enabled: valid && access.ready,
  });
  const retryAdmission = () => {
    if (access.unavailable || (status.error instanceof ApiError && status.error.status === 401)) void access.renew();
    else if (access.ready) void status.refetch();
  };
  const title = `${printer?.name || `${t('additionalCameras.printer')} ${printerId}`} — ${t('camera.bothCameras', 'Both Cameras')}`;
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
        className={windowMode ? presentation.windowHeader : presentation.embeddedHeader}
        style={{ touchAction: 'none' }}
      >
        <h1 className={`${windowMode ? "font-medium " : ""}text-sm text-white flex items-center gap-2 min-w-0 truncate`} title={title}>
          {windowMode ? <Camera className="w-4 h-4 shrink-0" /> : <GripVertical className="w-4 h-4 text-bambu-gray shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        <div className="flex items-center gap-1 no-drag shrink-0">
          {!minimized && (
            <button
              className={windowMode ? presentation.windowButton : presentation.embeddedButton}
              onClick={toggleFullscreen}
              title={fullscreen ? t('camera.exitFullscreen') : t('camera.fullscreen')}
            >
              {fullscreen ? <Minimize className={windowMode ? presentation.windowIcon : presentation.embeddedIcon} /> : windowMode ? <Maximize className={presentation.windowIcon} /> : <Fullscreen className={presentation.embeddedIcon} />}
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
              initialToken={admitted.token}
              presentation={windowMode ? 'window-pane' : 'embedded-pane'}
              fullscreen={fullscreen}
            />
            <AdditionalCameraPane printerId={printerId} initialToken={admitted.token} />
          </div>
        ) : (
          <div role="status" className="flex-1 flex flex-col gap-3 items-center justify-center p-4 text-sm text-bambu-gray">
            {!valid || access.unavailable || status.isError || status.data
              ? t('camera.cameraUnavailable')
              : t('camera.connectingToCamera')}
            {valid && (access.unavailable || status.isError || status.data) && (
              <button type="button" onClick={retryAdmission} className="px-4 py-2 bg-bambu-green text-white rounded hover:bg-bambu-green/80">
                {t('camera.retry')}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
