import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, getStreamToken, setStreamToken } from '../../api/client';
import { useStreamTokenSync } from '../../hooks/useCameraStreamToken';
import { ToastProvider } from '../../contexts/ToastContext';
import { EmbeddedCameraViewer } from '../../components/EmbeddedCameraViewer';
import { BothCameraOverlay } from '../../components/BothCameraOverlay';
import { AdditionalCameraOverlay } from '../../components/AdditionalCameraOverlay';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ loading: false, authEnabled: true, user: { id: 3 }, hasPermission: () => true }),
}));

// Match App: one persistent publisher, with independently mounted viewers below it.
function Harness({ peer }: { peer: 'both' | 'stock' | 'additional' | 'all' }) {
  useStreamTokenSync();
  const [stock, setStock] = useState(true);
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open peer</button>
    {stock && <EmbeddedCameraViewer printerId={1} printerName="Stock" onClose={() => setStock(false)} />}
    {open && (peer === 'stock' ? <EmbeddedCameraViewer printerId={1} printerName="Second Stock" onClose={() => setOpen(false)} /> :
      peer === 'additional' ? <AdditionalCameraOverlay printerId={1} onClose={() => setOpen(false)} /> :
        <BothCameraOverlay printerId={1} onClose={() => setOpen(false)} />)}
    {peer === 'all' && <AdditionalCameraOverlay printerId={1} onClose={() => {}} />}
  </>;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); setStreamToken(null); });

beforeEach(() => {
  vi.spyOn(api, 'getCameraStreamToken').mockResolvedValue({ token: 'shared-camera', expires_in: 3600 });
  vi.spyOn(api, 'getMediaToken').mockResolvedValue({ token: 'shared-media', expires_in: 3600 });
  vi.spyOn(api, 'getPrinter').mockResolvedValue({ id: 1, name: 'Printer' } as Awaited<ReturnType<typeof api.getPrinter>>);
  vi.spyOn(api, 'getPrinterStatus').mockResolvedValue({ state: 'IDLE' } as Awaited<ReturnType<typeof api.getPrinterStatus>>);
  vi.spyOn(api, 'getCameraStatus').mockResolvedValue({ active: true, stalled: false } as Awaited<ReturnType<typeof api.getCameraStatus>>);
  vi.spyOn(api, 'getAdditionalCameraStatus').mockResolvedValue({ configured: true, enabled: true, frames_recent: true } as Awaited<ReturnType<typeof api.getAdditionalCameraStatus>>);
});

it.each(['both', 'stock', 'additional', 'all'] as const)(
  'closing %s preserves Stock credentials, image, and normal recovery', async (peer) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter><Harness peer={peer} /></MemoryRouter></ToastProvider></QueryClientProvider>);
    const stock = document.querySelector('[data-camera-overlay="primary:1"]')!;
    await waitFor(() => expect(within(stock as HTMLElement).getByRole('img').getAttribute('src')).toContain('token=shared-camera'));
    const image = within(stock as HTMLElement).getByRole('img');
    fireEvent.load(image);
    const src = image.getAttribute('src');
    fireEvent.click(screen.getByText('Open peer'));
    const selector = peer === 'all' ? 'both' : peer === 'stock' ? 'primary' : peer;
    await waitFor(() => expect(document.querySelectorAll(`[data-camera-overlay="${selector}:1"] img`).length).toBe(peer === 'stock' || peer === 'both' || peer === 'all' ? 2 : 1));
    const peers = document.querySelectorAll(`[data-camera-overlay="${selector}:1"]`);
    const closing = peers[peers.length - 1] as HTMLElement;
    const owned = Array.from(closing.querySelectorAll('img'));
    const additional = peer === 'all'
      ? document.querySelector('[data-camera-overlay="additional:1"] img')
      : null;
    const additionalSrc = additional?.getAttribute('src');
    const requests = vi.spyOn(globalThis, 'fetch');
    fireEvent.click(within(closing).getByTitle('Close'));
    expect(closing).not.toBeInTheDocument();
    owned.forEach((img) => expect(img.getAttribute('src')).toBeFalsy());
    expect(requests.mock.calls.filter(([url]) => String(url).includes('/camera/stop')))
      .toHaveLength(peer === 'additional' ? 0 : 1);
    expect(getStreamToken()).toBe('shared-camera');
    expect(within(stock as HTMLElement).getByRole('img')).toBe(image);
    expect(image.getAttribute('src')).toBe(src);
    if (additional) {
      expect(additional).toBeInTheDocument();
      expect(additional.getAttribute('src')).toBe(additionalSrc);
      fireEvent.click(screen.getByText('Open peer'));
      await waitFor(() => expect(document.querySelectorAll('[data-camera-overlay="both:1"] img')).toHaveLength(2));
      expect(within(stock as HTMLElement).getByRole('img')).toBe(image);
      expect(image.getAttribute('src')).toBe(src);
      expect(additional.getAttribute('src')).toBe(additionalSrc);
    }
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(image.getAttribute('src')).toBe(src);
    // A later genuine transport error still reconnects using the same credentials.
    fireEvent.error(image);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const recovered = within(stock as HTMLElement).getByRole('img');
    expect(recovered).not.toBe(image);
    expect(recovered.getAttribute('src')).toContain('token=shared-camera');
    fireEvent.load(recovered);
    view.unmount(); client.clear();
  },
);

it('closing Stock preserves Both Primary through healthy status polling', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter><Harness peer="both" /></MemoryRouter></ToastProvider></QueryClientProvider>);
  await waitFor(() => expect(getStreamToken()).toBe('shared-camera'));
  fireEvent.click(screen.getByText('Open peer'));
  const both = await waitFor(() => {
    const el = document.querySelector('[data-camera-overlay="both:1"]')!;
    expect(el.querySelectorAll('img')).toHaveLength(2);
    return el;
  });
  const primary = both.querySelector('[data-camera-pane="primary"] img')!;
  const src = primary.getAttribute('src');
  fireEvent.load(primary);
  const stock = document.querySelector('[data-camera-overlay="primary:1"]')!;
  fireEvent.click(within(stock as HTMLElement).getByTitle('Close'));
  expect(stock).not.toBeInTheDocument();
  expect(primary).toBeInTheDocument();
  expect(primary.getAttribute('src')).toBe(src);
  expect(getStreamToken()).toBe('shared-camera');
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(both.querySelector('[data-camera-pane="primary"] img')).toBe(primary);
  expect(primary.getAttribute('src')).toBe(src);
  view.unmount(); client.clear();
});
