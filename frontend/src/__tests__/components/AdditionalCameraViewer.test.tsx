import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { api, setStreamToken } from '../../api/client';
import { ToastProvider } from '../../contexts/ToastContext';
import { AdditionalCameraPage } from '../../pages/AdditionalCameraPage';
import { AdditionalCameraOverlay } from '../../components/AdditionalCameraOverlay';
import { AdditionalCameraViewer } from '../../components/AdditionalCameraViewer';
import { AdditionalCameraTestEntry } from '../../components/AdditionalCameraTestEntry';
import { useStreamTokenSync } from '../../hooks/useCameraStreamToken';
import { EmbeddedCameraViewer } from '../../components/EmbeddedCameraViewer';

const auth = vi.hoisted(() => ({
  authEnabled: true,
  loading: false,
  user: { id: 3 },
  hasPermission: () => true,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));

const healthy = {
  configured: true,
  enabled: true,
  friendly_name: 'Overhead view',
  active_sessions: 1,
  frames_recent: true,
  last_frame_age_seconds: 0,
};
let cameraStatus = { ...healthy };
let statusTokens: (string | null)[];
let clients: QueryClient[];

function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}
function page(id = '1') {
  return mount(
    <MemoryRouter initialEntries={[`/camera/${id}/additional`]}>
      <Routes>
        <Route
          path="/camera/:printerId/additional"
          element={<AdditionalCameraPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
async function image() {
  return await screen.findByRole('img', { name: 'Camera stream' });
}
function noPrimaryStop(fetchSpy: ReturnType<typeof vi.spyOn>) {
  expect(
    fetchSpy.mock.calls.filter(([url]) => String(url).includes('/camera/stop')),
  ).toHaveLength(0);
}

beforeEach(() => {
  clients = [];
  cameraStatus = { ...healthy };
  statusTokens = [];
  auth.authEnabled = true;
  auth.loading = false;
  auth.hasPermission = () => true;
  const storage = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation(
    (key) => storage.get(key) ?? null,
  );
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.mocked(localStorage.removeItem).mockImplementation((key) => {
    storage.delete(key);
  });
  setStreamToken(null);
  server.use(
    http.post('*/api/v1/printers/camera/stream-token', () =>
      HttpResponse.json({ token: 'camera-token' }),
    ),
    http.get(
      '*/api/v1/printers/:id/additional-camera/status',
      ({ request }) => {
        statusTokens.push(new URL(request.url).searchParams.get('token'));
        return HttpResponse.json(cameraStatus);
      },
    ),
    http.get('*/api/v1/printers/:id', () =>
      HttpResponse.json({ id: 1, name: 'Stock printer', camera_rotation: 180 }),
    ),
    http.get('*/api/v1/printers/:id/status', () =>
      HttpResponse.json({ connected: true, state: 'IDLE' }),
    ),
    http.get('*/api/v1/printers/:id/camera/status', () =>
      HttpResponse.json({ active: true, stalled: false }),
    ),
    http.post('*/api/v1/printers/:id/camera/stop', () =>
      HttpResponse.json({ stopped: 1 }),
    ),
  );
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  setStreamToken(null);
});

describe('Additional Camera viewers', () => {
  it('uses the dedicated New Window route, reactive stream token, friendly title, and server rotation', async () => {
    const config = vi.spyOn(api, 'getAdditionalCamera');
    const primaryStatus = vi.spyOn(api, 'getCameraStatus');
    page();
    const img = await image();
    expect(img.getAttribute('src')).toBe(
      '/api/v1/printers/1/additional-camera/stream?fps=15&t=0&token=camera-token',
    );
    expect(statusTokens).toEqual(['camera-token']);
    expect(
      await screen.findByRole('heading', { name: 'Overhead view' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Overhead view - Camera'));
    // Backend applies Additional rotation. Never apply the primary 180° value
    // or rotate a server-rotated image twice in the browser.
    expect(img.style.transform).not.toContain('rotate');
    expect(config).not.toHaveBeenCalled();
    expect(primaryStatus).not.toHaveBeenCalled();
    fireEvent.load(img);
    expect(img.getAttribute('src')).toContain('additional-camera/stream');
    expect(
      screen.queryByText('Connecting to camera...'),
    ).not.toBeInTheDocument();
  });

  it('waits for the stream token before making any media or status request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', async () => {
        await gate;
        return HttpResponse.json({ token: 'a b/c=d' });
      }),
    );
    page();
    expect(screen.queryByRole('img')).toBeNull();
    expect(statusTokens).toEqual([]);
    await act(async () => release());
    expect((await image()).getAttribute('src')).toContain(
      'token=a%20b%2Fc%3Dd',
    );
    expect(statusTokens).toEqual(['a b/c=d']);
  });

  it('gates camera access during auth bootstrap and denies users without camera:view', async () => {
    auth.loading = true;
    const token = vi.spyOn(api, 'getCameraStreamToken');
    const { rerender } = mount(<AdditionalCameraViewer printerId={1} />);
    expect(token).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
    auth.loading = false;
    auth.hasPermission = () => false;
    // Re-render the same tree without losing its QueryClient provider.
    const client = clients[0];
    rerender(
      <QueryClientProvider client={client}>
        <AdditionalCameraViewer printerId={1} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
    expect(token).not.toHaveBeenCalled();
    expect(statusTokens).toEqual([]);
  });

  it('does not issue a tokenless request when token minting fails with auth enabled', async () => {
    server.use(
      http.post(
        '*/api/v1/printers/camera/stream-token',
        () => new HttpResponse(null, { status: 403 }),
      ),
    );
    page();
    expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(statusTokens).toEqual([]);
  });

  it('allows auth-disabled use after a failed token query has settled', async () => {
    auth.authEnabled = false;
    server.use(
      http.post(
        '*/api/v1/printers/camera/stream-token',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    page();
    expect((await image()).getAttribute('src')).toBe(
      '/api/v1/printers/1/additional-camera/stream?fps=15&t=0',
    );
  });

  it.each([
    { configured: false, enabled: false },
    { configured: true, enabled: false },
  ])(
    'shows unavailable for missing/disabled config without ever displaying stock: %j',
    async (values) => {
      cameraStatus = { ...healthy, ...values };
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      page();
      expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(screen.queryByRole('img')).toBeNull();
      cameraStatus = { ...healthy };
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect((await image()).getAttribute('src')).toContain(
        '/additional-camera/stream',
      );
      noPrimaryStop(fetchSpy);
    },
  );

  it('shows unavailable for a nonexistent printer and invalid route IDs', async () => {
    server.use(
      http.get('*/api/v1/printers/:id/additional-camera/status', () =>
        HttpResponse.json({ detail: 'Printer not found' }, { status: 404 }),
      ),
    );
    const first = page();
    expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
    first.unmount();
    page('not-a-printer');
    expect(screen.getByText('Camera unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses a generic title when no friendly name is saved', async () => {
    cameraStatus.friendly_name = '';
    page();
    expect(
      await screen.findByRole('heading', { name: 'Additional Camera' }),
    ).toBeInTheDocument();
  });

  it('retries only its own request and snapshot mode uses only the Additional snapshot endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    page();
    const original = await image();
    const src = original.getAttribute('src');
    fireEvent.error(original);
    expect(screen.getByText('Camera unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
    expect(original.getAttribute('src')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const next = await image();
    expect(next.getAttribute('src')).not.toBe(src);
    expect(next.getAttribute('src')).toContain('/additional-camera/stream');
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    expect((await image()).getAttribute('src')).toContain(
      '/additional-camera/snapshot?t=',
    );
    expect(next.getAttribute('src')).toBeNull();
    noPrimaryStop(fetchSpy);
  });

  it('automatically reconnects with a fresh request and cancels its timers on close', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const view = page();
    const first = await image();
    const firstSrc = first.getAttribute('src');
    vi.useFakeTimers();
    fireEvent.error(first);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    const second = screen.getByRole('img');
    expect(second.getAttribute('src')).not.toBe(firstSrc);
    fireEvent.error(second);
    view.unmount();
    const calls = fetchSpy.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(fetchSpy.mock.calls).toHaveLength(calls);
    noPrimaryStop(fetchSpy);
  });

  it('times out an image that never becomes displayable and stops after five retries', async () => {
    page();
    await image();
    vi.useFakeTimers();
    fireEvent.click(screen.getByTitle('Restart stream'));
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByText('Camera unavailable')).toBeInTheDocument();
    // First failure scheduled a 2-second reconnect; fail the next four images.
    for (const delay of [2000, 4000, 8000, 16000, 30000]) {
      await act(async () => {
        vi.advanceTimersByTime(delay);
      });
      fireEvent.error(screen.getByRole('img'));
    }
    expect(screen.getByText('Camera unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('disconnects on pagehide, restores a clean history session, and unmounts without a primary stop', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const view = page();
    const img = await image();
    fireEvent(window, new Event('pagehide'));
    expect(img.getAttribute('src')).toBeNull();
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    fireEvent(window, restored);
    const next = await image();
    expect(next).not.toBe(img);
    expect(next.getAttribute('src')).toContain('/additional-camera/stream');
    view.unmount();
    expect(next.getAttribute('src')).toBeNull();
    noPrimaryStop(fetchSpy);
  });

  it('keeps stock and Additional overlays live together and preserves independent geometry', async () => {
    localStorage.setItem(
      'embeddedCameraState_1',
      JSON.stringify({ x: 100, y: 80, width: 400, height: 300 }),
    );
    localStorage.setItem(
      'embeddedCameraState_additional:1',
      JSON.stringify({ x: 300, y: 200, width: 450, height: 350 }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const minted = vi.spyOn(api, 'getCameraStreamToken');
    vi.spyOn(api, 'getMediaToken').mockResolvedValue({
      token: 'media-token',
      expires_in: 3600,
    });
    function BothOverlaysForTest() {
      useStreamTokenSync();
      const [additional, setAdditional] = useState(true);
      return (
        <>
          <EmbeddedCameraViewer
            printerId={1}
            printerName="Stock printer"
            onClose={() => {}}
          />
          {additional && (
            <AdditionalCameraOverlay
              printerId={1}
              onClose={() => setAdditional(false)}
            />
          )}
        </>
      );
    }
    const view = mount(<BothOverlaysForTest />);
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    const extra = await within(overlay).findByRole('img');
    const stock = screen
      .getAllByRole('img')
      .find((img) => img.getAttribute('src')?.includes('/camera/stream'))!;
    await waitFor(() =>
      expect(stock.getAttribute('src')).toContain('token=camera-token'),
    );
    const stockSrc = stock.getAttribute('src');
    expect(extra.getAttribute('src')).toContain('/additional-camera/stream');
    expect(overlay.style.left).toBe('300px');
    expect(stock.closest('.fixed')).toHaveStyle({
      left: '100px',
      top: '80px',
      width: '400px',
      height: '300px',
    });
    fireEvent.error(extra);
    fireEvent.click(within(overlay).getByRole('button', { name: 'Retry' }));
    expect(stock.getAttribute('src')).toBe(stockSrc);
    expect(minted).toHaveBeenCalledOnce();
    fireEvent.click(within(overlay).getByTitle('Close'));
    expect(
      screen.queryByRole('region', { name: 'Additional Camera overlay' }),
    ).toBeNull();
    expect(stock.getAttribute('src')).toBe(stockSrc);
    noPrimaryStop(fetchSpy);
    view.unmount();
    expect(
      fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/camera/stop'),
      ),
    ).toHaveLength(1);
  });

  it('focuses either live overlay through video, controls, drag, resize, and minimized headers without persistence or transport changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mount(
      <>
        <EmbeddedCameraViewer
          printerId={1}
          printerName="Stock"
          onClose={() => {}}
        />
        <AdditionalCameraOverlay printerId={1} onClose={() => {}} />
      </>,
    );
    const extra = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    const extraImage = await within(extra).findByRole('img');
    const stockImage = screen
      .getAllByRole('img')
      .find((img) => img.getAttribute('src')?.includes('/camera/stream'))!;
    const stock = stockImage.closest('[data-camera-overlay]') as HTMLElement;
    const top = (overlay: HTMLElement, other: HTMLElement) => {
      expect(overlay.style.zIndex).toBe('41');
      expect(other.style.zIndex).toBe('40');
    };
    const geometry = (overlay: HTMLElement) => [
      overlay.style.left,
      overlay.style.top,
      overlay.style.width,
      overlay.style.height,
    ];
    const stockGeometry = geometry(stock);
    const extraGeometry = geometry(extra);
    const stockSrc = stockImage.getAttribute('src');
    const extraSrc = extraImage.getAttribute('src');
    // Let existing geometry debounce finish before observing focus-only writes.
    await waitFor(() =>
      expect(
        localStorage.getItem('embeddedCameraState_additional:1'),
      ).not.toBeNull(),
    );
    vi.mocked(localStorage.setItem).mockClear();
    fireEvent.click(extraImage);
    top(extra, stock);
    fireEvent.click(stockImage);
    top(stock, extra);
    fireEvent.click(extraImage);
    top(extra, stock);
    fireEvent.mouseDown(within(stock).getByText('Stock printer'), {
      button: 0,
    });
    top(stock, extra);
    fireEvent.mouseUp(document);
    fireEvent.pointerDown(within(extra).getByRole('heading'), { button: 0 });
    top(extra, stock);
    fireEvent.pointerUp(document);
    fireEvent.mouseDown(within(stock).getByTitle('Drag to resize'), {
      button: 0,
    });
    top(stock, extra);
    fireEvent.mouseUp(document);
    fireEvent.pointerDown(within(extra).getByRole('separator'), { button: 0 });
    top(extra, stock);
    fireEvent.pointerUp(document);
    fireEvent.focus(within(stock).getByTitle('Zoom in'));
    top(stock, extra);
    fireEvent.click(within(extra).getByTitle('Zoom in'));
    top(extra, stock);
    expect(geometry(stock)).toEqual(stockGeometry);
    expect(geometry(extra)).toEqual(extraGeometry);
    expect(stockImage.getAttribute('src')).toBe(stockSrc);
    expect(extraImage.getAttribute('src')).toBe(extraSrc);
    expect(within(stock).getByRole('img')).toBe(stockImage);
    expect(within(extra).getByRole('img')).toBe(extraImage);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    noPrimaryStop(fetchSpy);
    fireEvent.click(within(stock).getByTitle('Minimize'));
    fireEvent.click(within(extra).getByTitle('Minimize'));
    fireEvent.click(stock);
    top(stock, extra);
    fireEvent.click(extra);
    top(extra, stock);
  });

  it('matches stock minimize/expand sizing while keeping both states independent', async () => {
    localStorage.setItem(
      'embeddedCameraState_additional:1',
      JSON.stringify({ x: 50, y: 60, width: 450, height: 350 }),
    );
    mount(
      <>
        <EmbeddedCameraViewer
          printerId={1}
          printerName="Stock"
          onClose={() => {}}
        />
        <AdditionalCameraOverlay printerId={1} onClose={() => {}} />
      </>,
    );
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    await within(overlay).findByRole('img');
    const stock = screen
      .getAllByRole('img')
      .find((img) => img.getAttribute('src')?.includes('/camera/stream'))!
      .closest('.fixed') as HTMLElement;
    fireEvent.click(within(overlay).getByTitle('Minimize'));
    expect(overlay).toHaveStyle({ width: '200px', height: '40px' });
    expect(within(overlay).queryByRole('img')).toBeNull();
    expect(within(overlay).queryByRole('separator')).toBeNull();
    expect(within(stock).getByRole('img')).toBeInTheDocument();
    fireEvent.click(within(stock).getByTitle('Minimize'));
    fireEvent.click(within(overlay).getByTitle('Expand'));
    expect(overlay).toHaveStyle({ width: '450px', height: '350px' });
    expect(within(stock).queryByRole('img')).toBeNull();
    expect(within(stock).getByTitle('Expand')).toBeInTheDocument();
    fireEvent.click(within(stock).getByTitle('Expand'));
    expect(within(stock).getByRole('img')).toBeInTheDocument();
    expect(within(overlay).getByRole('img')).toBeInTheDocument();
  });

  it('restores page-owned Additional overlays on navigation without stopping primary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem(
      'embeddedCameraState_additional:1',
      JSON.stringify({ x: 50, y: 60, width: 450, height: 350 }),
    );
    mount(
      <MemoryRouter initialEntries={['/printers']}>
        <Link to="/settings">Settings</Link>
        <Link to="/printers">Printers</Link>
        <Routes>
          <Route path="/printers" element={<AdditionalCameraTestEntry />} />
          <Route path="/settings" element={<div>Settings page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const open = () =>
      act(() => {
        window.dispatchEvent(
          new CustomEvent('bambuddy:additional-camera-test', {
            detail: { printerId: 1, mode: 'embedded' },
          }),
        );
      });
    open();
    const img = await image();
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(img.getAttribute('src')).toBeNull();
    noPrimaryStop(fetchSpy);
    open();
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Printers' }));
    const restored = await image();
    expect(restored).not.toBe(img);
    expect(restored.getAttribute('src')).toContain('/additional-camera/stream');
    expect(screen.getByRole('region')).toHaveStyle({
      left: '50px',
      top: '60px',
      width: '450px',
      height: '350px',
    });
    noPrimaryStop(fetchSpy);
  });

  it('detects removal while open, detaches the image, and cancels pending reconnect', async () => {
    mount(<AdditionalCameraOverlay printerId={1} onClose={() => {}} />);
    const img = await image();
    fireEvent.load(img);
    cameraStatus = { ...healthy, configured: false, enabled: false };
    await act(async () => {
      await clients[0].refetchQueries({
        queryKey: ['additional-camera-viewer-status'],
      });
    });
    await waitFor(() =>
      expect(screen.getByText('Camera unavailable')).toBeInTheDocument(),
    );
    expect(img.getAttribute('src')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reuses zoom/pan and fullscreen presentation without changing stream identity', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const original = HTMLElement.prototype.requestFullscreen;
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    page();
    const img = await image();
    const src = img.getAttribute('src');
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(img.style.transform).toContain('scale(1.5)');
    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(img.parentElement!, { clientX: 120, clientY: 110 });
    expect(img.style.transform).toContain(
      'translate(13.333333333333334px, 6.666666666666667px)',
    );
    fireEvent.click(screen.getByTitle('Reset zoom'));
    expect(img.style.transform).toContain('scale(1)');
    fireEvent.click(screen.getByTitle('Fullscreen'));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(img.getAttribute('src')).toBe(src);
    HTMLElement.prototype.requestFullscreen = original;
  });

  it('persists Additional popup geometry without overwriting stock window geometry', async () => {
    localStorage.setItem(
      'cameraWindowState',
      JSON.stringify({ width: 777, height: 555 }),
    );
    page();
    await image();
    vi.useFakeTimers();
    fireEvent(window, new Event('resize'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(
      JSON.parse(localStorage.getItem('cameraWindowState_additional:1')!),
    ).toMatchObject({
      width: window.outerWidth,
      height: window.outerHeight,
      left: window.screenX,
      top: window.screenY,
    });
    expect(JSON.parse(localStorage.getItem('cameraWindowState')!)).toEqual({
      width: 777,
      height: 555,
    });
  });

  it('moves/resizes only Additional overlay geometry and restores it on reopen', async () => {
    const initial = { x: 200, y: 100, width: 430, height: 320 };
    localStorage.setItem(
      'embeddedCameraState_additional:1',
      JSON.stringify(initial),
    );
    localStorage.setItem(
      'embeddedCameraState_1',
      JSON.stringify({ ...initial, x: 80 }),
    );
    const first = mount(
      <AdditionalCameraOverlay printerId={1} onClose={() => {}} />,
    );
    await image();
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    // jsdom lacks PointerEvent; MouseEvent supplies the pointer coordinates.
    const pointer = (
      target: Element | Document,
      type: string,
      x: number,
      y: number,
    ) =>
      fireEvent(
        target,
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    pointer(within(overlay).getByRole('heading'), 'pointerdown', 200, 100);
    pointer(document, 'pointermove', 240, 130);
    pointer(document, 'pointerup', 240, 130);
    expect(overlay.style.left).toBe('240px');
    expect(overlay.style.top).toBe('130px');
    pointer(within(overlay).getByRole('separator'), 'pointerdown', 670, 450);
    pointer(document, 'pointermove', 700, 480);
    pointer(document, 'pointerup', 700, 480);
    expect(overlay.style.width).toBe('460px');
    expect(overlay.style.height).toBe('350px');
    await waitFor(
      () =>
        expect(
          JSON.parse(localStorage.getItem('embeddedCameraState_additional:1')!),
        ).toMatchObject({
          x: 240,
          width: 460,
        }),
      { timeout: 1500 },
    );
    expect(
      JSON.parse(localStorage.getItem('embeddedCameraState_1')!),
    ).toMatchObject({ x: 80, width: 430 });
    first.unmount();
    mount(<AdditionalCameraOverlay printerId={1} onClose={() => {}} />);
    expect(
      screen.getByRole('region', { name: 'Additional Camera overlay' }),
    ).toHaveStyle({
      left: '240px',
      width: '460px',
    });
  });

  it('flushes changed geometry when navigating before the save debounce finishes', async () => {
    localStorage.setItem(
      'embeddedCameraState_additional:1',
      JSON.stringify({ x: 200, y: 100, width: 430, height: 320 }),
    );
    const view = mount(
      <AdditionalCameraOverlay printerId={1} onClose={() => {}} />,
    );
    await image();
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    const pointer = (
      target: Element | Document,
      type: string,
      x: number,
      y: number,
    ) =>
      fireEvent(
        target,
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    pointer(within(overlay).getByRole('heading'), 'pointerdown', 200, 100);
    pointer(document, 'pointermove', 240, 130);
    pointer(document, 'pointerup', 240, 130);
    view.unmount();
    expect(
      JSON.parse(localStorage.getItem('embeddedCameraState_additional:1')!),
    ).toMatchObject({ x: 240, y: 130 });
  });

  it('keeps Additional live when the stock overlay closes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    function CoexistenceHarness() {
      const [stock, setStock] = useState(true);
      return (
        <>
          {stock && (
            <EmbeddedCameraViewer
              printerId={1}
              printerName="Stock printer"
              onClose={() => setStock(false)}
            />
          )}
          <AdditionalCameraOverlay printerId={1} onClose={() => {}} />
        </>
      );
    }
    mount(<CoexistenceHarness />);
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    const extra = await within(overlay).findByRole('img');
    const src = extra.getAttribute('src');
    const stockImage = screen
      .getAllByRole('img')
      .find((img) => img.getAttribute('src')?.includes('/camera/stream'))!;
    fireEvent.click(
      within(stockImage.closest('.fixed') as HTMLElement).getByTitle('Close'),
    );
    expect(extra.getAttribute('src')).toBe(src);
    expect(
      fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/camera/stop'),
      ),
    ).toHaveLength(1);
  });

  it('Retry renews a rejected stream token through the existing authenticated token query', async () => {
    let minted = 0;
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', () =>
        HttpResponse.json({ token: ++minted === 1 ? 'expired' : 'renewed' }),
      ),
      http.get(
        '*/api/v1/printers/:id/additional-camera/status',
        ({ request }) =>
          new URL(request.url).searchParams.get('token') === 'renewed'
            ? HttpResponse.json(healthy)
            : HttpResponse.json(
                { detail: 'Valid camera stream token required' },
                { status: 401 },
              ),
      ),
    );
    vi.spyOn(api, 'getMediaToken').mockResolvedValue({
      token: 'media-token',
      expires_in: 3600,
    });
    function RecoveryHarness() {
      useStreamTokenSync();
      return (
        <>
          <EmbeddedCameraViewer
            printerId={1}
            printerName="Stock printer"
            onClose={() => {}}
          />
          <AdditionalCameraOverlay printerId={1} onClose={() => {}} />
        </>
      );
    }
    mount(<RecoveryHarness />);
    expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
    const stock = screen.getByRole('img');
    await waitFor(() =>
      expect(stock.getAttribute('src')).toContain('token=expired'),
    );
    const stockSrc = stock.getAttribute('src');
    const overlay = screen.getByRole('region', {
      name: 'Additional Camera overlay',
    });
    expect(within(overlay).queryByRole('img')).toBeNull();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Retry' }));
    expect(
      (await within(overlay).findByRole('img')).getAttribute('src'),
    ).toContain('token=renewed');
    expect(stock.getAttribute('src')).toBe(stockSrc);
  });

  it('opens no transport until the temporary console entry is explicitly invoked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount(<AdditionalCameraTestEntry />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(statusTokens).toEqual([]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('bambuddy:additional-camera-test', {
          detail: { printerId: 1, mode: 'window' },
        }),
      );
    });
    expect(open).toHaveBeenCalledWith(
      '/camera/1/additional',
      'camera-additional:1',
      expect.any(String),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('bambuddy:additional-camera-test', {
          detail: { printerId: 1, mode: 'embedded' },
        }),
      );
    });
    expect((await image()).getAttribute('src')).toContain(
      '/additional-camera/stream',
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('bambuddy:additional-camera-test', {
          detail: { printerId: 1, mode: 'embedded' },
        }),
      );
    });
    expect(
      screen.getAllByRole('region', { name: 'Additional Camera overlay' }),
    ).toHaveLength(1);
  });
});
