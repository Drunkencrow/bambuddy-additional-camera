import { CAMERA_ICON_LABEL_KEYS } from '../../components/AuxiliaryCameraIcons';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const locales = import.meta.glob('../../i18n/locales/*.ts', { eager: true, import: 'default' });
const components = [
  'components/AdditionalCameraSettings.tsx',
  'components/AdditionalCameraViewer.tsx',
  'components/AdditionalCameraOverlay.tsx',
  'components/BothCameraViewer.tsx',
  'components/BothCameraOverlay.tsx',
  'components/AuxiliaryCameraControls.tsx',
  'components/FloatingCameraFrame.tsx',
];
const keys = new Set(components.flatMap((file) => {
  const source = readFileSync(resolve('src', file), 'utf8');
  return [...source.matchAll(/\bt\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
}));
// Settings search/tab labels are passed indirectly to t().
keys.add('settings.tabs.additionalCameras');
keys.add('additionalCameras.additionalIcon');
keys.add('additionalCameras.bothIcon');
Object.values(CAMERA_ICON_LABEL_KEYS).forEach((key) => keys.add(key));

describe('Additional Camera translations', () => {
  it.each(Object.entries(locales))('%s defines every feature key without relying on English fallbacks', (_file, locale) => {
    for (const key of keys) {
      const value = key.split('.').reduce<unknown>((node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, locale);
      expect.soft(value, key).toBeTypeOf('string');
      expect.soft(value, key).not.toBe('');
    }
  });
});
