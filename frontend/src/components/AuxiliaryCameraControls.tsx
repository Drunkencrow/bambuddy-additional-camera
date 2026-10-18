import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, PictureInPicture2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useCameraStreamAccess } from '../hooks/useCameraStreamToken';
import { openCameraWindow, type CameraViewMode } from '../utils/camera';
import { Button } from './Button';
import { ContextMenu } from './ContextMenu';
import { AdditionalCameraIcon, BothCamerasIcon } from './AuxiliaryCameraIcons';

type Source = 'additional' | 'both';
export interface AuxiliaryCameraControlsProps {
  printerId: number;
  connected: boolean;
  viewMode: CameraViewMode;
  onSelectViewMode: (mode: CameraViewMode) => void;
  onOpenEmbedded: (source: Source, printerId: number) => void;
}

/** Credential-free availability, shared by every rendering of this printer. */
export function AuxiliaryCameraControls(props: AuxiliaryCameraControlsProps) {
  const { hasPermission } = useAuth();
  const access = useCameraStreamAccess();
  const status = useQuery({
    queryKey: ['additional-camera-viewer-status', `additional:${props.printerId}`, access.token],
    queryFn: () => api.getAdditionalCameraStatus(props.printerId, access.token),
    enabled: hasPermission('camera:view') && access.ready,
    staleTime: 30000,
    refetchInterval: 30000,
    retry: false,
  });
  // Availability has no Retry button. Renew a rejected token locally so the
  // controls recover after a server restart without reconnecting open feeds.
  const lastRenewal = useRef(0);
  useEffect(() => {
    if (status.error instanceof ApiError && status.error.status === 401 && Date.now() - lastRenewal.current >= 30000) {
      lastRenewal.current = Date.now();
      void access.renew();
    }
  }, [status.error, status.errorUpdatedAt, access]);
  if (!access.ready || !hasPermission('camera:view') || status.isError || !status.data?.configured || !status.data.enabled) return null;
  return <>{(['additional', 'both'] as const).map((source) => <CameraControl key={source} {...props} source={source} />)}</>;
}

function CameraControl({ source, printerId, connected, viewMode, onSelectViewMode, onOpenEmbedded }: AuxiliaryCameraControlsProps & { source: Source }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const allowed = connected && hasPermission('camera:view');
  const title = source === 'additional' ? t('camera.additionalCamera') : t('camera.bothCameras');
  const Icon = source === 'additional' ? AdditionalCameraIcon : BothCamerasIcon;
  const open = (mode: CameraViewMode) => {
    if (!allowed) return;
    if (mode === 'embedded') onOpenEmbedded(source, printerId);
    else openCameraWindow(printerId, source);
  };
  return (
    <div className="flex items-center flex-shrink-0" data-camera-control={source}>
      <Button variant="secondary" size="sm" onClick={() => open(viewMode)} disabled={!allowed}
        title={title} aria-label={title} className="!h-8 !min-h-8 !w-8 !px-0 !py-0 !rounded-r-none">
        <Icon className="w-[var(--pc-i4,1rem)] h-[var(--pc-i4,1rem)]" />
      </Button>
      <Button variant="secondary" size="sm" disabled={!allowed}
        title={`${title} — ${t('settings.cameraViewMode')}`} aria-label={`${title} — ${t('settings.cameraViewMode')}`}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ x: rect.left, y: rect.bottom + 4 }); }}
        className="!h-8 !min-h-8 !w-6 !px-0 !py-0 !rounded-l-none border-l border-bambu-dark">
        <ChevronDown className="w-3 h-3" />
      </Button>
      {anchor && allowed && <ContextMenu x={anchor.x} y={anchor.y} onClose={() => setAnchor(null)} items={[
        { mode: 'window' as const, icon: <ExternalLink className="w-4 h-4" />, label: t('settings.newWindow'), title: t('settings.cameraWindowDescription') },
        { mode: 'embedded' as const, icon: <PictureInPicture2 className="w-4 h-4" />, label: t('settings.embeddedOverlay'), title: t('settings.cameraOverlayDescription') },
      ].map(({ mode, ...item }) => ({ ...item, label: mode === viewMode ? `${item.label} ✓` : item.label, onClick: () => { if (!allowed) return; onSelectViewMode(mode); open(mode); } }))} />}
    </div>
  );
}
