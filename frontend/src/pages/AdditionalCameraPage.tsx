import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdditionalCameraViewer } from '../components/AdditionalCameraViewer';
import { cameraPopupGeometryKey, cameraViewerIdentity } from '../utils/cameraIdentity';

export function AdditionalCameraPage() {
  const { printerId } = useParams<{ printerId: string }>();
  const id = Number(printerId);
  const storageKey = cameraPopupGeometryKey('additional', id);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!Number.isSafeInteger(id) || id <= 0) return;
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              width: window.outerWidth,
              height: window.outerHeight,
              left: window.screenX,
              top: window.screenY,
            }),
          );
        } catch {
          /* Geometry applies until this window closes. */
        }
      }, 500);
    };
    window.addEventListener('resize', save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', save);
    };
  }, [id, storageKey]);
  return (
    <div className="h-dvh bg-black">
      <AdditionalCameraViewer key={cameraViewerIdentity('additional', id)} printerId={id} windowMode />
    </div>
  );
}
