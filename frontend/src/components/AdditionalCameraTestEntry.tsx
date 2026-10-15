import { useEffect } from 'react';
import { useOpenEmbeddedCameras } from '../hooks/useOpenEmbeddedCameras';
import { useAuth } from '../contexts/AuthContext';
import { AdditionalCameraOverlay } from './AdditionalCameraOverlay';
import { cameraViewerIdentity } from '../utils/cameraIdentity';
import { openCameraWindow } from '../utils/camera';

/** Temporary Phase 3 console entry. No launcher appears in the production UI.
 * window.dispatchEvent(new CustomEvent('bambuddy:additional-camera-test', {
 *   detail: { printerId: 1, mode: 'embedded' } // or 'window'
 * }));
 * Open intent survives navigation, like the stock Embedded Overlay.
 */
export function AdditionalCameraTestEntry() {
  const { loading, authEnabled, user, hasPermission } = useAuth();
  const allowed =
    !loading && (!authEnabled || (!!user && hasPermission('camera:view')));
  const [viewers, setViewers] = useOpenEmbeddedCameras<{ id: number }>(
    'additional'
  );
  useEffect(() => {
    if (!allowed) return;
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail;
      if (
        !detail ||
        !Number.isSafeInteger(detail.printerId) ||
        detail.printerId <= 0
      )
        return;
      if (detail.mode === 'window')
        openCameraWindow(detail.printerId, 'additional');
      else if (detail.mode === 'embedded')
        setViewers((old) =>
          new Map(old).set(detail.printerId, { id: detail.printerId })
        );
    };
    window.addEventListener('bambuddy:additional-camera-test', open);
    return () =>
      window.removeEventListener('bambuddy:additional-camera-test', open);
  }, [allowed, setViewers]);
  if (!allowed) return null;
  return (
    <>
      {Array.from(viewers, ([printerId], index) => (
        <AdditionalCameraOverlay
          key={cameraViewerIdentity('additional', printerId)}
          printerId={printerId}
          viewerIndex={index}
          onClose={() =>
            setViewers((old) => {
              const next = new Map(old);
              next.delete(printerId);
              return next;
            })
          }
        />
      ))}
    </>
  );
}
