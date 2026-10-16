import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { BothCameraOverlay } from './BothCameraOverlay';
import { useEffect } from 'react';
import { useOpenEmbeddedCameras } from '../hooks/useOpenEmbeddedCameras';
import { useAuth } from '../contexts/AuthContext';
import { AdditionalCameraOverlay } from './AdditionalCameraOverlay';
import { cameraViewerIdentity } from '../utils/cameraIdentity';
import { openCameraWindow } from '../utils/camera';

/** Temporary camera console entry. No launcher appears in the production UI.
 * window.dispatchEvent(new CustomEvent('bambuddy:additional-camera-test', {
 *   detail: { printerId: 1, mode: 'embedded' } // or 'window'
 * }));
 * Add viewer: 'both' for Both Cameras; omitted viewer remains Additional.
 * Open intent survives navigation, like the stock Embedded Overlay.
 */
export function AdditionalCameraTestEntry() {
  const queryClient = useQueryClient();
  const [bothViewers, setBothViewers] = useOpenEmbeddedCameras<{ id: number }>('both');
  const { loading, authEnabled, user, hasPermission } = useAuth();
  const allowed = !loading && (!authEnabled || (!!user && hasPermission('camera:view')));
  const [viewers, setViewers] = useOpenEmbeddedCameras<{ id: number }>('additional');
  useEffect(() => {
    if (!allowed) return;
    let disposed = false;
    const open = async (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail;
      if (!detail || !Number.isSafeInteger(detail.printerId) || detail.printerId <= 0) return;
      if (detail.viewer !== undefined && detail.viewer !== 'additional' && detail.viewer !== 'both') return;
      if (detail.viewer === 'both') {
        if (detail.mode !== 'embedded' && detail.mode !== 'window') return;
        try {
          const tokenData = await queryClient
            .fetchQuery({
              queryKey: ['camera-stream-token', user?.id ?? null],
              queryFn: () => api.getCameraStreamToken(),
              staleTime: 50 * 60 * 1000,
              retry: false,
            })
            .catch(() => null);
          if (disposed || (authEnabled && !tokenData?.token)) return;
          const status = await api.getAdditionalCameraStatus(detail.printerId, tokenData?.token);
          if (disposed || !status.configured || !status.enabled) return;
          if (detail.mode === 'window') openCameraWindow(detail.printerId, 'both');
          else setBothViewers((old) => new Map(old).set(detail.printerId, { id: detail.printerId }));
        } catch {
          /* Missing, disabled, or inaccessible Additional must never become a second Primary. */
        }
        return;
      }
      if (detail.mode === 'window') openCameraWindow(detail.printerId, 'additional');
      else if (detail.mode === 'embedded')
        setViewers((old) => new Map(old).set(detail.printerId, { id: detail.printerId }));
    };
    window.addEventListener('bambuddy:additional-camera-test', open);
    return () => {
      disposed = true;
      window.removeEventListener('bambuddy:additional-camera-test', open);
    };
  }, [allowed, setViewers, setBothViewers, queryClient, user?.id, authEnabled]);
  if (!allowed) return null;
  return (
    <>
      {Array.from(bothViewers, ([printerId], index) => (
        <BothCameraOverlay
          key={cameraViewerIdentity('both', printerId)}
          printerId={printerId}
          viewerIndex={index}
          onClose={() =>
            setBothViewers((old) => {
              const next = new Map(old);
              next.delete(printerId);
              return next;
            })
          }
        />
      ))}
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
