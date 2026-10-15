/** Stock minimized dimensions; expanded geometry is retained independently. */
export function cameraOverlaySize(minimized: boolean, size: { width: number; height: number }) {
  return {
    width: minimized ? 200 : size.width,
    height: minimized ? 40 : size.height,
  };
}
