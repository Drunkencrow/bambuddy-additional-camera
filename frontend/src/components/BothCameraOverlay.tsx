import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { BothCameraViewer } from './BothCameraViewer';
import { FloatingCameraFrame } from './FloatingCameraFrame';
import { CameraMinimizeButton } from './CameraMinimizeButton';
import { cameraOverlayGeometryKey, cameraViewerIdentity } from '../utils/cameraIdentity';

export function BothCameraOverlay({
  printerId,
  viewerIndex = 0,
  onClose,
}: {
  printerId: number;
  viewerIndex?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [minimized, setMinimized] = useState(false);
  return (
    <FloatingCameraFrame
      identity={cameraViewerIdentity('both', printerId)}
      storageKey={cameraOverlayGeometryKey('both', printerId)}
      viewerIndex={viewerIndex}
      minimized={minimized}
      defaultSize={{ width: 860, height: 420 }}
      label={t('camera.bothOverlay', 'Both Cameras overlay')}
    >
      <BothCameraViewer
        printerId={printerId}
        minimized={minimized}
        headerActions={
          <>
            <CameraMinimizeButton minimized={minimized} onToggle={() => setMinimized(!minimized)} />
            <button onClick={onClose} title={t('common.close')} className="p-1 rounded hover:bg-red-500/20">
              <X className="w-3.5 h-3.5 text-bambu-gray hover:text-red-600 dark:hover:text-red-400" />
            </button>
          </>
        }
      />
    </FloatingCameraFrame>
  );
}
