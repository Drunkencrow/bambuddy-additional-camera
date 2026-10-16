import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { api, setStreamToken } from '../../api/client';
import { ToastProvider } from '../../contexts/ToastContext';
import { BothCameraPage } from '../../pages/BothCameraPage';
import { BothCameraViewer } from '../../components/BothCameraViewer';
import { BothCameraOverlay } from '../../components/BothCameraOverlay';
import { EmbeddedCameraViewer } from '../../components/EmbeddedCameraViewer';
import { AdditionalCameraTestEntry } from '../../components/AdditionalCameraTestEntry';
import { useOpenEmbeddedCameras } from '../../hooks/useOpenEmbeddedCameras';

const auth = vi.hoisted(() => ({ loading: false, authEnabled: true, user: { id: 3 }, hasPermission: () => true }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
const healthy = {
  configured: true,
  enabled: true,
  friendly_name: 'Overhead view',
  frames_recent: true,
  active_sessions: 1,
};
let additional = { ...healthy };
let clients: QueryClient[];

function mount(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
function viewer(windowMode = false) {
  return mount(<BothCameraViewer printerId={1} windowMode={windowMode} />);
}
function pane(source: string, parent: ParentNode = document) {
  return parent.querySelector(`[data-camera-pane="${source}"]`)! as HTMLElement;
}
async function feeds(parent: ParentNode = document) {
  await waitFor(() => expect(parent.querySelectorAll('[data-camera-pane] img')).toHaveLength(2));
  return {
    primary: within(pane('primary', parent)).getByRole('img'),
    extra: within(pane('additional', parent)).getByRole('img'),
  };
}
function launch(viewer: 'both' | 'additional' | undefined, mode = 'embedded') {
  act(() =>
    window.dispatchEvent(
      new CustomEvent('bambuddy:additional-camera-test', { detail: { printerId: 1, viewer, mode } }),
    ),
  );
}
function pointer(target: Element | Document, type: string, x: number, y: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}
function stopCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(([url]) => String(url).includes('/camera/stop'));
}

beforeEach(() => {
  clients = [];
  additional = { ...healthy };
  auth.loading = false;
  auth.authEnabled = true;
  auth.hasPermission = () => true;
  const storage = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.mocked(localStorage.removeItem).mockImplementation((key) => {
    storage.delete(key);
  });
  setStreamToken(null);
  vi.spyOn(api, 'getMediaToken').mockResolvedValue({ token: 'media-token', expires_in: 3600 });
  server.use(
    http.post('*/api/v1/printers/camera/stream-token', () => HttpResponse.json({ token: 'a b/c=d' })),
    http.get('*/api/v1/printers/:id/additional-camera/status', () => HttpResponse.json(additional)),
    http.get('*/api/v1/printers/:id', () => HttpResponse.json({ id: 1, name: 'Test printer', camera_rotation: 90 })),
    http.get('*/api/v1/printers/:id/status', () => HttpResponse.json({ connected: true, state: 'IDLE' })),
    http.get('*/api/v1/printers/:id/camera/status', () => HttpResponse.json({ active: true, stalled: false })),
    http.post('*/api/v1/printers/:id/camera/stop', () => HttpResponse.json({ skipped: true, stopped: 0 })),
  );
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  setStreamToken(null);
});

describe('Both Cameras feeds and failure isolation', () => {
  it('renders independent authenticated Primary and Additional endpoints with modest labels and independent rotation', async () => {
    viewer();
    const { primary, extra } = await feeds();
    expect(primary.getAttribute('src')).toMatch(/\/1\/camera\/stream\?fps=15&t=\d+&token=a%20b%2Fc%3Dd/);
    expect(extra.getAttribute('src')).toBe(
      '/api/v1/printers/1/additional-camera/stream?fps=15&t=0&token=a%20b%2Fc%3Dd',
    );
    expect(within(pane('primary')).getByRole('heading')).toHaveTextContent('Primary');
    expect(within(pane('additional')).getByRole('heading')).toHaveTextContent('Overhead view');
    expect(primary.style.transform).toContain('rotate(90deg)');
    expect(extra.style.transform).not.toContain('rotate');
    expect(screen.getAllByTitle('Fullscreen')).toHaveLength(1);
  });

  it('uses the fallback Additional label', async () => {
    additional.friendly_name = '';
    viewer();
    await feeds();
    expect(within(pane('additional')).getByRole('heading')).toHaveTextContent('Additional Camera');
  });

  it('waits for authentication tokens before making either media request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', async () => {
        await gate;
        return HttpResponse.json({ token: 'ready' });
      }),
    );
    viewer();
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => release());
    const { primary, extra } = await feeds();
    expect(primary.getAttribute('src')).toContain('token=ready');
    expect(extra.getAttribute('src')).toContain('token=ready');
  });

  it.each(['bootstrap', 'permission'])('opens no feeds during %s denial', async (reason) => {
    auth.loading = reason === 'bootstrap';
    auth.hasPermission = () => false;
    const token = vi.spyOn(api, 'getCameraStreamToken');
    viewer();
    expect(screen.queryByRole('img')).toBeNull();
    expect(token).not.toHaveBeenCalled();
  });

  it.each([
    { configured: false, enabled: false },
    { configured: true, enabled: false },
  ])('rejects an initial missing/disabled Additional configuration: %j', async (config) => {
    additional = { ...healthy, ...config };
    viewer();
    expect(await screen.findByText('Camera unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([false, true])(
    'Additional failure and Retry preserve the Primary element, URL, viewport, and token (window=%s)',
    async (windowMode) => {
      const spy = vi.spyOn(globalThis, 'fetch');
      const minted = vi.spyOn(api, 'getCameraStreamToken');
      viewer(windowMode);
      const { primary, extra } = await feeds();
      fireEvent.load(primary);
      fireEvent.click(within(pane('primary')).getByTitle('Zoom in'));
      const src = primary.getAttribute('src');
      fireEvent.error(extra);
      expect(within(pane('additional')).getByText('Camera unavailable')).toBeInTheDocument();
      expect(within(pane('primary')).getByRole('img')).toBe(primary);
      fireEvent.click(within(pane('additional')).getByRole('button', { name: 'Retry' }));
      const next = (await feeds()).extra;
      expect(next).not.toBe(extra);
      expect(within(pane('primary')).getByRole('img')).toBe(primary);
      expect(primary.getAttribute('src')).toBe(src);
      expect(primary.style.transform).toContain('scale(1.5)');
      expect(minted).toHaveBeenCalledOnce();
      expect(stopCalls(spy)).toHaveLength(0);
    },
  );

  it.each([false, true])(
    'Primary failure/recovery preserve the Additional element and URL (window=%s)',
    async (windowMode) => {
      viewer(windowMode);
      const { primary, extra } = await feeds();
      fireEvent.load(extra);
      const src = extra.getAttribute('src');
      vi.useFakeTimers();
      fireEvent.error(primary);
      expect(within(pane('primary')).getAllByText(/Reconnecting|Connection lost/)[0]).toBeInTheDocument();
      expect(within(pane('additional')).getByRole('img')).toBe(extra);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(within(pane('primary')).getByRole('img')).not.toBe(primary);
      expect(within(pane('additional')).getByRole('img')).toBe(extra);
      expect(extra.getAttribute('src')).toBe(src);
    },
  );

  it('keeps Primary mounted when Additional configuration disappears after admission', async () => {
    viewer();
    const { primary, extra } = await feeds();
    const src = primary.getAttribute('src');
    additional = { ...healthy, configured: false, enabled: false };
    await act(async () => {
      await clients[0].refetchQueries({ queryKey: ['additional-camera-viewer-status'] });
    });
    await waitFor(() => expect(within(pane('additional')).queryByRole('img')).toBeNull());
    expect(extra.getAttribute('src')).toBeNull();
    expect(within(pane('primary')).getByRole('img')).toBe(primary);
    expect(primary.getAttribute('src')).toBe(src);
  });

  it.each(['primary', 'additional'])('zoom, pan, and Reset affect only %s', async (source) => {
    viewer();
    await feeds();
    const own = pane(source),
      other = pane(source === 'primary' ? 'additional' : 'primary');
    const img = within(own).getByRole('img'),
      peer = within(other).getByRole('img');
    const original = peer.style.transform;
    fireEvent.click(within(own).getByTitle('Zoom in'));
    fireEvent.click(within(own).getByTitle('Zoom in'));
    expect(img.style.transform).toContain('scale(2)');
    expect(peer.style.transform).toBe(original);
    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(img.closest('[style*="touch-action"]') || img.parentElement!, { clientX: 120, clientY: 110 });
    expect(img.style.transform).toContain('translate(10px, 5px)');
    expect(peer.style.transform).toBe(original);
    fireEvent.mouseUp(img);
    fireEvent.click(within(own).getByTitle('Reset zoom'));
    expect(img.style.transform).toContain('scale(1) translate(0px, 0px)');
    expect(peer.style.transform).toBe(original);
  });

  it.each([false, true])(
    'fullscreen targets Both only and refreshes only popup Primary (window=%s)',
    async (windowMode) => {
      const request = vi.fn().mockResolvedValue(undefined);
      const exit = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
      viewer(windowMode);
      const { primary, extra } = await feeds();
      const src = extra.getAttribute('src');
      const root = document.querySelector('[data-camera-viewer="both:1"]')!;
      fireEvent.click(screen.getByTitle('Fullscreen'));
      expect(request.mock.instances[0]).toBe(root);
      vi.useFakeTimers();
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: root });
      fireEvent(document, new Event('fullscreenchange'));
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(within(pane('primary')).getByRole('img') === primary).toBe(!windowMode);
      expect(within(pane('additional')).getByRole('img')).toBe(extra);
      expect(extra.getAttribute('src')).toBe(src);
      fireEvent.click(screen.getByTitle('Exit fullscreen'));
      expect(exit).toHaveBeenCalledOnce();
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      fireEvent(document, new Event('fullscreenchange'));
    },
  );

  it('ignores fullscreen changes belonging to another viewer', async () => {
    viewer(true);
    const { primary, extra } = await feeds();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByTitle('Fullscreen')).toBeInTheDocument();
    expect(within(pane('primary')).getByRole('img')).toBe(primary);
    expect(within(pane('additional')).getByRole('img')).toBe(extra);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  it.each([false, true])('preserves launch-mode stall recovery thresholds (window=%s)', async (windowMode) => {
    vi.spyOn(api, 'getCameraStatus').mockResolvedValue({ active: false, stalled: false } as Awaited<
      ReturnType<typeof api.getCameraStatus>
    >);
    viewer(windowMode);
    const { primary, extra } = await feeds();
    vi.useFakeTimers();
    fireEvent.load(primary);
    fireEvent.load(extra);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(within(pane('primary')).queryAllByText(/Reconnecting|Connection lost/).length > 0).toBe(!windowMode);
    if (windowMode) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(within(pane('primary')).getAllByText(/Reconnecting|Connection lost/).length).toBeGreaterThan(0);
    }
    expect(within(pane('additional')).getByRole('img')).toBe(extra);
  });

  it('renews a failed Primary token locally without changing Additional token or image', async () => {
    let minted = 0;
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', () =>
        HttpResponse.json({ token: ++minted === 1 ? 'original' : 'primary-renewed' }),
      ),
    );
    viewer();
    const { primary, extra } = await feeds();
    const src = extra.getAttribute('src');
    fireEvent.error(primary);
    await waitFor(() =>
      expect(within(pane('primary')).getByRole('img').getAttribute('src')).toContain('token=primary-renewed'),
    );
    expect(within(pane('additional')).getByRole('img')).toBe(extra);
    expect(extra.getAttribute('src')).toBe(src);
    expect(minted).toBe(2);
  });

  it('renews a rejected Additional token locally without changing Primary token or image', async () => {
    let minted = 0,
      reject = false;
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', () =>
        HttpResponse.json({ token: ++minted === 1 ? 'original' : 'additional-renewed' }),
      ),
      http.get('*/api/v1/printers/:id/additional-camera/status', ({ request }) =>
        reject && new URL(request.url).searchParams.get('token') !== 'additional-renewed'
          ? HttpResponse.json({ detail: 'Token expired' }, { status: 401 })
          : HttpResponse.json(healthy),
      ),
    );
    viewer();
    const { primary } = await feeds();
    const src = primary.getAttribute('src');
    reject = true;
    await act(async () => {
      await clients[0].refetchQueries({ queryKey: ['additional-camera-viewer-status'] });
    });
    await within(pane('additional')).findByText('Camera unavailable');
    fireEvent.click(within(pane('additional')).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(within(pane('additional')).getByRole('img').getAttribute('src')).toContain('token=additional-renewed'),
    );
    expect(within(pane('primary')).getByRole('img')).toBe(primary);
    expect(primary.getAttribute('src')).toBe(src);
  });

  it('switches Additional to Snapshot without touching Primary', async () => {
    viewer();
    const { primary } = await feeds();
    const src = primary.getAttribute('src');
    fireEvent.click(within(pane('additional')).getByRole('button', { name: 'Snapshot' }));
    expect(within(pane('additional')).getByRole('img').getAttribute('src')).toContain('/additional-camera/snapshot?');
    expect(within(pane('primary')).getByRole('img')).toBe(primary);
    expect(primary.getAttribute('src')).toBe(src);
  });

  it('sends exactly one guarded Primary stop on Both close, with no Additional stop endpoint', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const view = viewer(true);
    const { extra } = await feeds();
    fireEvent(window, new Event('beforeunload'));
    view.unmount();
    expect(stopCalls(spy)).toHaveLength(1);
    expect(stopCalls(spy)[0][1]).toMatchObject({ method: 'POST', keepalive: true, headers: expect.any(Object) });
    expect(extra.getAttribute('src')).toBeNull();
    expect(spy.mock.calls.filter(([url]) => String(url).includes('/additional-camera/stop'))).toHaveLength(0);
  });
});

function ThreeOverlays() {
  const [stock, setStock] = useOpenEmbeddedCameras<{ id: number }>('primary');
  return (
    <>
      <button onClick={() => setStock(new Map([[1, { id: 1 }]]))}>Open Stock</button>
      {stock.has(1) && <EmbeddedCameraViewer printerId={1} printerName="Stock" onClose={() => setStock(new Map())} />}
      <AdditionalCameraTestEntry />
    </>
  );
}
function overlays() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-camera-overlay]'));
}
function overlay(source: string) {
  return document.querySelector<HTMLElement>(`[data-camera-overlay="${source}:1"]`)!;
}
async function three() {
  mount(<ThreeOverlays />);
  fireEvent.click(screen.getByText('Open Stock'));
  launch('additional');
  launch('both');
  await waitFor(() => expect(overlays()).toHaveLength(3));
  await feeds(overlay('both'));
  await within(overlay('additional')).findByRole('img');
}

describe('Both Cameras overlays, launcher, and restoration', () => {
  it('registers only one Both frame; all three identities coexist with bounded focus', async () => {
    await three();
    expect(
      overlays()
        .map((el) => el.dataset.cameraOverlay)
        .sort(),
    ).toEqual(['additional:1', 'both:1', 'primary:1']);
    const bothFeeds = await feeds(overlay('both'));
    const src = bothFeeds.primary.getAttribute('src');
    for (const name of ['both', 'primary', 'additional', 'both', 'primary']) {
      fireEvent.click(within(overlay(name)).getAllByRole('img')[0]);
      expect(overlay(name).style.zIndex).toBe('41');
      expect(overlays().filter((el) => el.style.zIndex === '41')).toHaveLength(1);
      expect(overlays().every((el) => ['40', '41'].includes(el.style.zIndex))).toBe(true);
    }
    expect(bothFeeds.primary.getAttribute('src')).toBe(src);
    expect((await feeds(overlay('both'))).primary).toBe(bothFeeds.primary);
  });

  it.each(['primary', 'additional', 'both'])(
    'closing %s leaves other viewers mounted and releases only its own images',
    async (source) => {
      await three();
      const survivors = overlays()
        .filter((el) => el !== overlay(source))
        .flatMap((el) => Array.from(el.querySelectorAll('img')))
        .map((img) => ({ img, src: img.getAttribute('src') }));
      const owned = Array.from(overlay(source).querySelectorAll('img'));
      const spy = vi.spyOn(globalThis, 'fetch');
      fireEvent.click(within(overlay(source)).getByTitle('Close'));
      expect(overlay(source)).toBeNull();
      survivors.forEach(({ img, src }) => {
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toBe(src);
      });
      expect(stopCalls(spy)).toHaveLength(source === 'additional' ? 0 : 1);
      owned.forEach((img) => expect(img).not.toBeInTheDocument());
    },
  );

  it('moves, resizes, flushes, and restores only Both geometry', async () => {
    localStorage.setItem('embeddedCameraState_both:1', JSON.stringify({ x: 40, y: 70, width: 700, height: 400 }));
    localStorage.setItem('embeddedCameraState_additional:1', 'untouched');
    const first = mount(<BothCameraOverlay printerId={1} onClose={() => {}} />);
    await feeds();
    const both = overlay('both');
    pointer(within(both).getByRole('heading', { level: 1, name: /Both Cameras/ }), 'pointerdown', 40, 70);
    pointer(document, 'pointermove', 60, 90);
    pointer(document, 'pointerup', 60, 90);
    expect(both).toHaveStyle({ left: '60px', top: '90px' });
    pointer(within(both).getByRole('separator'), 'pointerdown', 760, 490);
    pointer(document, 'pointermove', 790, 510);
    pointer(document, 'pointerup', 790, 510);
    expect(both).toHaveStyle({ width: '730px', height: '420px' });
    first.unmount();
    expect(JSON.parse(localStorage.getItem('embeddedCameraState_both:1')!)).toEqual({
      x: 60,
      y: 90,
      width: 730,
      height: 420,
    });
    expect(localStorage.getItem('embeddedCameraState_additional:1')).toBe('untouched');
    mount(<BothCameraOverlay printerId={1} onClose={() => {}} />);
    expect(overlay('both')).toHaveStyle({ left: '60px', width: '730px' });
  });

  it('minimizes/expands Both independently without clearing open intent or geometry', async () => {
    await three();
    const both = overlay('both');
    const width = both.style.width;
    const stock = within(overlay('primary')).getByRole('img');
    const extra = within(overlay('additional')).getByRole('img');
    fireEvent.click(within(both).getByTitle('Minimize'));
    expect(both).toHaveStyle({ width: '200px', height: '40px' });
    expect(within(both).queryByRole('img')).toBeNull();
    expect(within(both).queryByRole('separator')).toBeNull();
    expect(stock).toBeInTheDocument();
    expect(extra).toBeInTheDocument();
    expect(localStorage.getItem('openEmbeddedCameras_both')).toBe('[{"id":1}]');
    fireEvent.click(within(both).getByTitle('Expand'));
    await feeds(both);
    expect(both.style.width).toBe(width);
    expect(within(overlay('primary')).getByRole('img')).toBe(stock);
    expect(within(overlay('additional')).getByRole('img')).toBe(extra);
  });

  it.each([['both'], ['primary', 'both'], ['additional', 'both'], ['primary', 'additional', 'both']])(
    'restores independent open intent expanded after navigation: %j',
    async (...sources) => {
      const names = sources.flat() as string[];
      names.forEach((source) =>
        localStorage.setItem(
          source === 'primary' ? 'openEmbeddedCameras' : `openEmbeddedCameras_${source}`,
          '[{"id":1}]',
        ),
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      clients.push(client);
      render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter initialEntries={['/printers']}>
              <Link to="/away">Away</Link>
              <Link to="/printers">Printers</Link>
              <Routes>
                <Route path="/printers" element={<ThreeOverlays />} />
                <Route path="/away" element={<div>Away page</div>} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>,
      );
      await feeds(overlay('both'));
      const old = (await feeds(overlay('both'))).extra;
      fireEvent.click(within(overlay('both')).getByTitle('Minimize'));
      fireEvent.click(screen.getByRole('link', { name: 'Away' }));
      expect(overlays()).toHaveLength(0);
      expect(old.getAttribute('src')).toBeNull();
      fireEvent.click(screen.getByRole('link', { name: 'Printers' }));
      await feeds(overlay('both'));
      expect(overlays()).toHaveLength(names.length);
      expect(within(overlay('both')).getByTitle('Minimize')).toBeInTheDocument();
      expect((await feeds(overlay('both'))).extra).not.toBe(old);
      fireEvent.click(within(overlay('both')).getByTitle('Close'));
      expect(localStorage.getItem('openEmbeddedCameras_both')).toBeNull();
      fireEvent.click(screen.getByRole('link', { name: 'Away' }));
      fireEvent.click(screen.getByRole('link', { name: 'Printers' }));
      expect(overlay('both')).toBeNull();
      expect(overlays()).toHaveLength(names.length - 1);
    },
  );

  it('keeps the old launcher syntax Additional and opens Both in an independent popup', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount(<AdditionalCameraTestEntry />);
    launch(undefined, 'window');
    expect(open).toHaveBeenCalledWith('/camera/1/additional', 'camera-additional:1', expect.any(String));
    launch('both', 'window');
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        '/camera/1/both',
        'camera-both:1',
        expect.stringContaining('width=1000,height=560'),
      ),
    );
    launch('both');
    await waitFor(() => expect(overlay('both')).not.toBeNull());
    await feeds(overlay('both'));
    launch('both');
    await waitFor(() => expect(overlays()).toHaveLength(1));
  });

  it.each([false, true])(
    'Both launcher fails safely if Additional is absent or disabled (configured=%s)',
    async (configured) => {
      additional = { ...healthy, configured, enabled: false };
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const status = vi.spyOn(api, 'getAdditionalCameraStatus');
      mount(<AdditionalCameraTestEntry />);
      launch('both', 'window');
      launch('both');
      await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(open).not.toHaveBeenCalled();
      expect(overlays()).toHaveLength(0);
    },
  );

  it('loads the dedicated route and saves only Both popup geometry and title', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/camera/1/both']}>
            <Routes>
              <Route path="/camera/:printerId/both" element={<BothCameraPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await feeds();
    await waitFor(() => expect(document.title).toBe('Test printer — Both Cameras'));
    localStorage.setItem('cameraWindowState', 'stock');
    localStorage.setItem('cameraWindowState_additional:1', 'additional');
    vi.useFakeTimers();
    fireEvent(window, new Event('resize'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(JSON.parse(localStorage.getItem('cameraWindowState_both:1')!)).toMatchObject({
      width: window.outerWidth,
      height: window.outerHeight,
    });
    expect(localStorage.getItem('cameraWindowState')).toBe('stock');
    expect(localStorage.getItem('cameraWindowState_additional:1')).toBe('additional');
  });
});
