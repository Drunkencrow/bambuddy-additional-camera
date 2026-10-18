import { useState } from 'react';
import { CameraMinimizeButton } from './CameraMinimizeButton';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdditionalCameraViewer } from './AdditionalCameraViewer';
import { FloatingCameraFrame } from './FloatingCameraFrame';
import { cameraOverlayGeometryKey, cameraViewerIdentity } from '../utils/cameraIdentity';

export function AdditionalCameraOverlay({
  printerId,
  viewerIndex = 0,
  onClose,
}: {
  printerId: number;
  viewerIndex?: number;
  onClose: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  return (
    <FloatingCameraFrame
      key={cameraViewerIdentity('additional', printerId)}
      identity={cameraViewerIdentity('additional', printerId)}
      storageKey={cameraOverlayGeometryKey('additional', printerId)}
      viewerIndex={viewerIndex}
      minimized={minimized}
    >
      <OverlayContent
        printerId={printerId}
        onClose={onClose}
        minimized={minimized}
        onToggle={() => setMinimized(!minimized)}
      />
    </FloatingCameraFrame>
  );
}

function OverlayContent({
  printerId,
  onClose,
  minimized,
  onToggle,
}: {
  printerId: number;
  onClose: () => void;
  minimized: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AdditionalCameraViewer
      printerId={printerId}
      minimized={minimized}
      headerActions={
        <>
          <CameraMinimizeButton label={minimized ? t('additionalCameras.expand') : t('additionalCameras.minimize')} minimized={minimized} onToggle={onToggle} />
          <button onClick={onClose} title={t('common.close', 'Close')} className="p-1 rounded hover:bg-red-500/20">
            <X className="w-3.5 h-3.5 text-bambu-gray hover:text-red-600 dark:hover:text-red-400" />
          </button>
        </>
      }
    />
  );
}
