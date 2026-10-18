import { useAuth } from '../contexts/AuthContext';
import { useOpenEmbeddedCameras } from './useOpenEmbeddedCameras';
import { AdditionalCameraOverlay } from '../components/AdditionalCameraOverlay';
import { BothCameraOverlay } from '../components/BothCameraOverlay';

/** Permanent page-owned open intent; transport and geometry stay in viewers. */
export function useAuxiliaryCameraViewers() {
  const [additional, setAdditional] = useOpenEmbeddedCameras<{ id: number }>('additional');
  const [both, setBoth] = useOpenEmbeddedCameras<{ id: number }>('both');
  const { loading, authEnabled, user, hasPermission } = useAuth();
  const allowed = !loading && (!authEnabled || (!!user && hasPermission('camera:view')));
  const open = (source: 'additional' | 'both', printerId: number) => {
    if (!allowed) return;
    const set = source === 'additional' ? setAdditional : setBoth;
    set((old) => new Map(old).set(printerId, { id: printerId }));
  };
  const viewers = allowed ? <>
    {Array.from(additional, ([id], index) => <AdditionalCameraOverlay key={`additional:${id}`} printerId={id} viewerIndex={index} onClose={() => setAdditional((old) => { const next = new Map(old); next.delete(id); return next; })} />)}
    {Array.from(both, ([id], index) => <BothCameraOverlay key={`both:${id}`} printerId={id} viewerIndex={index} onClose={() => setBoth((old) => { const next = new Map(old); next.delete(id); return next; })} />)}
  </> : null;
  return { open, viewers };
}
