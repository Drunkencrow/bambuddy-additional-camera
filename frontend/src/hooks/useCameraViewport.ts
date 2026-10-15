import { useState, useCallback, type RefObject } from 'react';

/** Presentation only: mouse/touch zoom and pan, with no camera lifecycle. */
export function useCameraViewport(containerRef: RefObject<HTMLDivElement | null>) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  const [lastTouchCenter, setLastTouchCenter] = useState<{ x: number; y: number } | null>(null);
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.5, 4));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => {
      const newZoom = Math.max(prev - 0.5, 1);
      if (newZoom === 1) setPanOffset({ x: 0, y: 0 });
      return newZoom;
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  // Calculate max pan based on container size and zoom level
  const getMaxPan = useCallback(() => {
    if (!containerRef.current) {
      return { x: 300, y: 200 };
    }
    const container = containerRef.current.getBoundingClientRect();
    // Allow panning up to half the zoomed overflow in each direction
    const maxX = (container.width * (zoomLevel - 1)) / 2;
    const maxY = (container.height * (zoomLevel - 1)) / 2;
    return { x: Math.max(50, maxX), y: Math.max(50, maxY) };
  }, [zoomLevel, containerRef]);

  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (isPanning && zoomLevel > 1) {
      const newX = e.clientX - panStart.x;
      const newY = e.clientY - panStart.y;
      const maxPan = getMaxPan();
      setPanOffset({
        x: Math.max(-maxPan.x, Math.min(maxPan.x, newX)),
        y: Math.max(-maxPan.y, Math.min(maxPan.y, newY)),
      });
    }
  };

  const handleImageMouseUp = () => {
    setIsPanning(false);
  };

  // Touch event handlers for mobile
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touches: React.TouchList) => {
    if (touches.length < 2) {
      return { x: touches[0].clientX, y: touches[0].clientY };
    }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch gesture start
      e.preventDefault();
      setLastTouchDistance(getTouchDistance(e.touches));
      setLastTouchCenter(getTouchCenter(e.touches));
    } else if (e.touches.length === 1 && zoomLevel > 1) {
      // Single touch pan start
      e.preventDefault();
      setIsPanning(true);
      setPanStart({
        x: e.touches[0].clientX - panOffset.x,
        y: e.touches[0].clientY - panOffset.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistance !== null) {
      // Pinch gesture
      e.preventDefault();
      const newDistance = getTouchDistance(e.touches);
      const scale = newDistance / lastTouchDistance;

      setZoomLevel((prev) => {
        const newZoom = Math.max(1, Math.min(4, prev * scale));
        if (newZoom === 1) {
          setPanOffset({ x: 0, y: 0 });
        }
        return newZoom;
      });

      setLastTouchDistance(newDistance);

      // Also handle pan during pinch
      const newCenter = getTouchCenter(e.touches);
      if (lastTouchCenter) {
        const maxPan = getMaxPan();
        setPanOffset((prev) => ({
          x: Math.max(-maxPan.x, Math.min(maxPan.x, prev.x + (newCenter.x - lastTouchCenter.x))),
          y: Math.max(-maxPan.y, Math.min(maxPan.y, prev.y + (newCenter.y - lastTouchCenter.y))),
        }));
      }
      setLastTouchCenter(newCenter);
    } else if (e.touches.length === 1 && isPanning && zoomLevel > 1) {
      // Single touch pan
      e.preventDefault();
      const newX = e.touches[0].clientX - panStart.x;
      const newY = e.touches[0].clientY - panStart.y;
      const maxPan = getMaxPan();
      setPanOffset({
        x: Math.max(-maxPan.x, Math.min(maxPan.x, newX)),
        y: Math.max(-maxPan.y, Math.min(maxPan.y, newY)),
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setLastTouchDistance(null);
      setLastTouchCenter(null);
    }
    if (e.touches.length === 0) {
      setIsPanning(false);
    }
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return {
    zoomLevel,
    setZoomLevel,
    panOffset,
    setPanOffset,
    isPanning,
    handleZoomIn,
    handleZoomOut,
    resetZoom,
    handleWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    handleImageMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
