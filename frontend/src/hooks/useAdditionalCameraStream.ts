import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import { useCameraStreamAccess } from './useCameraStreamToken';
import { cameraViewerIdentity } from '../utils/cameraIdentity';

type StreamPhase = 'loading' | 'live' | 'reconnecting' | 'unavailable';

/** One mounted viewer owns one request. No primary registry or stop operation. */
export function useAdditionalCameraStream(printerId: number, initialToken?: string, paused = false) {
  const access = useCameraStreamAccess(initialToken);
  const validId = Number.isSafeInteger(printerId) && printerId > 0;
  const status = useQuery({
    queryKey: ['additional-camera-viewer-status', cameraViewerIdentity('additional', printerId), access.token],
    queryFn: () => api.getAdditionalCameraStatus(printerId, access.token),
    enabled: validId && access.ready && !paused,
    retry: false,
    staleTime: 0,
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
  });
  const available = !paused && validId && access.ready && !status.isError && !!status.data?.configured && !!status.data.enabled;
  const unavailable =
    !validId ||
    access.unavailable ||
    status.isError ||
    (!!status.data && (!status.data.configured || !status.data.enabled));
  const [phase, setPhase] = useState<StreamPhase>('loading');
  const [requestKey, setRequestKey] = useState(0);
  const [mode, setMode] = useState<'stream' | 'snapshot'>('stream');
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallStrikes = useRef(0);

  const clearReconnect = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const failed = useCallback(() => {
    if (timer.current) return;
    setPhase('unavailable');
    if (!available || mode === 'snapshot' || attempts.current >= 5) return;
    const delay = Math.min(2000 * 2 ** attempts.current, 30000);
    attempts.current += 1;
    setPhase('reconnecting');
    timer.current = setTimeout(() => {
      timer.current = null;
      setRequestKey((key) => key + 1);
      setPhase('loading');
    }, delay);
  }, [available, mode]);

  const loaded = useCallback(() => {
    clearReconnect();
    attempts.current = 0;
    stallStrikes.current = 0;
    setPhase('live');
  }, [clearReconnect]);

  const retry = () => {
    clearReconnect();
    attempts.current = 0;
    stallStrikes.current = 0;
    setRequestKey((key) => key + 1);
    setPhase('loading');
    if (status.error instanceof ApiError && status.error.status === 401) void access.renew();
    else if (access.ready) void status.refetch();
    else if (access.unavailable) void access.renew();
  };

  const switchMode = (next: 'stream' | 'snapshot') => {
    if (next === mode) return;
    clearReconnect();
    attempts.current = 0;
    stallStrikes.current = 0;
    setMode(next);
    setRequestKey((key) => key + 1);
    setPhase('loading');
  };

  useEffect(() => clearReconnect, [clearReconnect]);
  useEffect(() => {
    clearReconnect();
    attempts.current = 0;
    stallStrikes.current = 0;
    setPhase('loading');
  }, [paused, clearReconnect]);
  useEffect(() => {
    if (!available) clearReconnect();
  }, [available, clearReconnect]);
  useEffect(() => {
    if (unavailable) setPhase('unavailable');
  }, [unavailable]);

  // Detect an image that never becomes displayable, including HTTP failures
  // that a browser does not report through onError for an MJPEG response.
  useEffect(() => {
    if (!available || phase !== 'loading') return;
    const timeout = setTimeout(failed, 30000);
    return () => clearTimeout(timeout);
  }, [available, phase, requestKey, failed]);

  useEffect(() => {
    if (!available || phase !== 'live' || mode !== 'stream') return;
    if (status.data?.frames_recent) stallStrikes.current = 0;
    else if (++stallStrikes.current >= 2) failed();
  }, [available, phase, mode, status.data, status.dataUpdatedAt, failed]);

  const visiblePhase = unavailable ? 'unavailable' : phase;
  const url =
    available && (visiblePhase === 'loading' || visiblePhase === 'live')
      ? `/api/v1/printers/${printerId}/additional-camera/${mode}?${mode === 'stream' ? 'fps=15&' : ''}t=${requestKey}${access.token ? `&token=${encodeURIComponent(access.token)}` : ''}`
      : null;

  return {
    url,
    phase: visiblePhase,
    mode,
    retry,
    switchMode,
    loaded,
    failed,
    friendlyName: status.data?.friendly_name,
  };
}
