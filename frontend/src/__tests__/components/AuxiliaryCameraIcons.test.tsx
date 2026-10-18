import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_CAMERA_ICONS, BOTH_CAMERA_ICONS, AdditionalCameraIcon, BothCamerasIcon,
  resolveAdditionalCameraIcon, resolveBothCameraIcon,
} from '../../components/AuxiliaryCameraIcons';

describe('Auxiliary camera artwork registry', () => {
  it.each([
    ...Object.entries(ADDITIONAL_CAMERA_ICONS).map(([id, Icon]) => ({ id, Icon, resolve: resolveAdditionalCameraIcon })),
    ...Object.entries(BOTH_CAMERA_ICONS).map(([id, Icon]) => ({ id, Icon, resolve: resolveBothCameraIcon })),
  ])('resolves and renders $id with decorative outline semantics', ({ id, Icon, resolve }) => {
    expect(resolve(id)).toBe(Icon);
    const { container } = render(<Icon className="w-4 h-4" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-camera-icon', id === 'camera-plus' ? 'additional' : id === 'dual-camera' ? 'both' : id);
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveClass('w-4', 'h-4');
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it.each([undefined, null, '', 'unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])('falls back safely for %s', (id) => {
    expect(resolveAdditionalCameraIcon(id)).toBe(AdditionalCameraIcon);
    expect(resolveBothCameraIcon(id)).toBe(BothCamerasIcon);
  });

  it('rejects cross-family selections', () => {
    expect(resolveAdditionalCameraIcon('dual-camera')).toBe(AdditionalCameraIcon);
    expect(resolveBothCameraIcon('webcam')).toBe(BothCamerasIcon);
  });

  it('preserves the exact approved default geometry', () => {
    const additional = render(<AdditionalCameraIcon />).container.querySelector('svg')!;
    expect(additional.innerHTML).toBe('<rect x="2" y="6" width="13" height="12" rx="2"></rect><path d="m15 10 7-4v12l-7-4M6 12h5M8.5 9.5v5"></path>');
    const both = render(<BothCamerasIcon />).container.querySelector('svg')!;
    expect(both.innerHTML).toBe('<rect x="7" y="3" width="10" height="7" rx="1.5"></rect><path d="m17 5 5-2v7l-5-2"></path><rect x="2" y="14" width="10" height="7" rx="1.5"></rect><path d="m12 16 5-2v7l-5-2"></path>');
  });
});
