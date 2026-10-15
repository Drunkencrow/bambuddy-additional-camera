import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ToastProvider } from '../../contexts/ToastContext';
import { EmbeddedCameraViewer } from '../../components/EmbeddedCameraViewer';
import { setStreamToken } from '../../api/client';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
let client: QueryClient;
function viewer() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <EmbeddedCameraViewer printerId={1} printerName="Stock printer" onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  setStreamToken('stock-token');
  server.use(
    http.get('*/api/v1/printers/:id', () => HttpResponse.json({ id: 1, name: 'Stock printer', camera_rotation: 180 })),
    http.get('*/api/v1/printers/:id/status', () => HttpResponse.json({ connected: true, state: 'IDLE' })),
    http.post('*/api/v1/printers/:id/camera/stop', () => HttpResponse.json({ stopped: 1 })),
  );
});
afterEach(() => {
  client.clear();
  setStreamToken(null);
  vi.restoreAllMocks();
});

describe('EmbeddedCameraViewer stock regression', () => {
  it('keeps its primary endpoint, stream token, and printer rotation', async () => {
    viewer();
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('/printers/1/camera/stream?fps=15');
    expect(img.getAttribute('src')).toContain('token=stock-token');
    await waitFor(() => expect(img.style.transform).toContain('rotate(180deg)'));
  });

  it('still sends its primary stop once on unmount and releases the browser request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const view = viewer();
    const img = screen.getByRole('img');
    view.unmount();
    const calls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/camera/stop'));
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
    expect(img.getAttribute('src')).toBe('');
  });

  it('still sends a primary stop on refresh', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    viewer();
    fireEvent.load(screen.getByRole('img'));
    fireEvent.click(screen.getByTitle('Refresh stream'));
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/camera/stop'))).toHaveLength(1);
  });
});
