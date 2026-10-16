import { useEffect, useState } from 'react';
import { cameraEmbeddedIntentKey, type CameraSource } from '../utils/cameraIdentity';

/** Persist user open/close intent, never component visibility or minimize state.
 * Route unmount releases transports without clearing the list. Keep the stock
 * key and serialized array compatible with existing browser state.
 */
export function useOpenEmbeddedCameras<T extends { id: number }>(
  source: CameraSource
) {
  const storageKey = cameraEmbeddedIntentKey(source);
  const [viewers, setViewers] = useState<Map<number, T>>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const cameras = JSON.parse(saved) as T[];
        return new Map(cameras.map((camera) => [camera.id, camera]));
      } catch {
        return new Map();
      }
    }
    return new Map();
  });

  useEffect(() => {
    const cameras = Array.from(viewers.values());
    if (cameras.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(cameras));
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [viewers, storageKey]);

  return [viewers, setViewers] as const;
}
