export type CameraSource = 'primary' | 'additional';

export function cameraViewerIdentity(source: CameraSource, printerId: number): string {
  return `${source}:${printerId}`;
}

// Keep primary names and storage keys compatible with existing saved state.
export function cameraPopupName(source: CameraSource, printerId: number): string {
  return source === 'primary' ? `camera-${printerId}` : `camera-${cameraViewerIdentity(source, printerId)}`;
}

export function cameraPopupGeometryKey(source: CameraSource, printerId: number): string {
  return source === 'primary' ? 'cameraWindowState' : `cameraWindowState_${cameraViewerIdentity(source, printerId)}`;
}

export function cameraOverlayGeometryKey(source: CameraSource, printerId: number): string {
  return source === 'primary'
    ? `embeddedCameraState_${printerId}`
    : `embeddedCameraState_${cameraViewerIdentity(source, printerId)}`;
}
