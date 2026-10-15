import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraOverlayGeometryKey,
  cameraPopupGeometryKey,
  cameraPopupName,
  cameraViewerIdentity,
} from '../../utils/cameraIdentity';
import { openCameraWindow } from '../../utils/camera';

describe('camera viewer identity and popup geometry', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, value);
    });
  });

  it('keeps primary legacy names/keys and namespaces Additional by source and printer', () => {
    expect(cameraViewerIdentity('primary', 1)).toBe('primary:1');
    expect(cameraViewerIdentity('additional', 1)).toBe('additional:1');
    expect(cameraPopupName('primary', 1)).toBe('camera-1');
    expect(cameraPopupName('additional', 1)).toBe('camera-additional:1');
    expect(cameraPopupGeometryKey('primary', 1)).toBe('cameraWindowState');
    expect(cameraPopupGeometryKey('additional', 1)).toBe('cameraWindowState_additional:1');
    expect(cameraOverlayGeometryKey('primary', 1)).toBe('embeddedCameraState_1');
    expect(cameraOverlayGeometryKey('additional', 1)).toBe('embeddedCameraState_additional:1');
    expect(cameraOverlayGeometryKey('additional', 2)).not.toBe(cameraOverlayGeometryKey('additional', 1));
  });

  it('opens each popup with its own saved geometry and preserves the existing stock route', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    localStorage.setItem('cameraWindowState', JSON.stringify({ width: 700, height: 500, left: 10, top: 20 }));
    localStorage.setItem(
      'cameraWindowState_additional:1',
      JSON.stringify({ width: 800, height: 600, left: 30, top: 40 }),
    );
    openCameraWindow(1);
    openCameraWindow(1, 'additional');
    expect(open).toHaveBeenNthCalledWith(
      1,
      '/camera/1',
      'camera-1',
      'width=700,height=500,left=10,top=20,menubar=no,toolbar=no,location=no,status=no',
    );
    expect(open).toHaveBeenNthCalledWith(
      2,
      '/camera/1/additional',
      'camera-additional:1',
      'width=800,height=600,left=30,top=40,menubar=no,toolbar=no,location=no,status=no',
    );
    open.mockRestore();
  });

  it('falls back to popup defaults without reading another camera geometry', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    localStorage.setItem('cameraWindowState', JSON.stringify({ width: 900 }));
    localStorage.setItem('cameraWindowState_additional:1', '{bad');
    openCameraWindow(1, 'additional');
    expect(open).toHaveBeenCalledWith(
      '/camera/1/additional',
      'camera-additional:1',
      'width=640,height=400,menubar=no,toolbar=no,location=no,status=no',
    );
    open.mockRestore();
  });
});
