import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../contexts/ToastContext';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { AdditionalCameraSettings } from '../../components/AdditionalCameraSettings';
import { AuxiliaryCameraControls } from '../../components/AuxiliaryCameraControls';
import { BothCameraViewer } from '../../components/BothCameraViewer';
import { AdditionalCameraViewer } from '../../components/AdditionalCameraViewer';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ loading: false, authEnabled: false, hasPermission: () => true }) }));

describe('Saved camera icon live update', () => {
  it('updates mounted controls through Settings invalidation while preserving media identity', async () => {
    let config = {
      id: 1, printer_id: 1, friendly_name: 'Side', enabled: true, camera_type: 'mjpeg', camera_url: 'http://camera/video',
      snapshot_url: null, rotation: 0, additional_icon: 'camera-plus', both_icon: 'dual-camera', created_at: '', updated_at: '',
    };
    let statusReads = 0;
    let tokenReads = 0;
    server.use(
      http.get('*/api/v1/printers/', () => HttpResponse.json([{ id: 1, name: 'Printer one' }])),
      http.get('*/api/v1/printers/1', () => HttpResponse.json({ id: 1, name: 'Printer one' })),
      http.post('*/api/v1/printers/camera/stream-token', () => { tokenReads++; return HttpResponse.json({ token: 'stable' }); }),
      http.get('*/api/v1/printers/1/additional-camera', () => HttpResponse.json(config)),
      http.put('*/api/v1/printers/1/additional-camera', async ({ request }) => {
        config = { ...config, ...await request.json() as object }; return HttpResponse.json(config);
      }),
      http.get('*/api/v1/printers/1/additional-camera/status', () => {
        statusReads++;
        return HttpResponse.json({ configured: true, enabled: config.enabled, additional_icon: config.additional_icon,
          both_icon: config.both_icon, frames_recent: true, active_sessions: 1, last_frame_age_seconds: 0 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter>
      <AdditionalCameraSettings />
      <AuxiliaryCameraControls printerId={1} connected viewMode="window" onSelectViewMode={vi.fn()} onOpenEmbedded={vi.fn()} />
      <AdditionalCameraViewer printerId={1} />
      <BothCameraViewer printerId={1} />
    </MemoryRouter></ToastProvider></QueryClientProvider>);
    const button = await screen.findByRole('button', { name: 'Additional Camera' });
    expect(button.querySelector('svg')).toHaveAttribute('data-camera-icon', 'additional');
    expect(screen.getByRole('button', { name: 'Both Cameras' }).querySelector('svg')).toHaveAttribute('data-camera-icon', 'both');
    const img = await waitFor(() => {
      const img = view.container.querySelector('img[src*="additional-camera/stream"]');
      expect(img).not.toBeNull(); return img!;
    });
    await waitFor(() => expect(view.container.querySelectorAll('img[src*="camera/stream"]')).toHaveLength(3));
    const media = [...view.container.querySelectorAll('img[src*="camera/stream"]')];
    const sources = media.map((element) => element.getAttribute('src'));
    media.forEach((element) => fireEvent.load(element));
    const src = img.getAttribute('src');
    const reads = statusReads;
    const tokens = tokenReads;
    const card = within(await screen.findByRole('region', { name: 'Printer one' }));
    fireEvent.click(card.getByRole('combobox', { name: 'Additional Camera Icon' }));
    fireEvent.click(card.getByRole('option', { name: 'Webcam' }));
    fireEvent.click(card.getByRole('combobox', { name: 'Both Cameras Icon' }));
    fireEvent.click(card.getByRole('option', { name: 'Side-by-Side Cameras' }));
    fireEvent.click(card.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(button.querySelector('svg')).toHaveAttribute('data-camera-icon', 'webcam'));
    expect(screen.getByRole('button', { name: 'Additional Camera' })).toBe(button);
    expect(screen.getByRole('button', { name: 'Both Cameras' }).querySelector('svg')).toHaveAttribute('data-camera-icon', 'side-by-side');
    expect(statusReads).toBeGreaterThan(reads);
    expect(tokenReads).toBe(tokens);
    expect(view.container.querySelector('img[src*="additional-camera/stream"]')).toBe(img);
    expect(img.getAttribute('src')).toBe(src);
    expect([...view.container.querySelectorAll('img[src*="camera/stream"]')]).toEqual(media);
    expect(media.map((element) => element.getAttribute('src'))).toEqual(sources);
    expect(button).toHaveClass('!h-8', '!min-h-8', '!w-8', '!px-0', '!py-0');
    expect(button.querySelector('svg')).toHaveClass('w-[var(--pc-i4,1rem)]', 'h-[var(--pc-i4,1rem)]');
    fireEvent.click(screen.getByRole('button', { name: 'Additional Camera — Camera View Mode' }));
    expect(screen.getByText(/New Window/)).toBeInTheDocument();
    expect(screen.getByText('Embedded Overlay')).toBeInTheDocument();
    view.unmount(); client.clear();
  });
});
