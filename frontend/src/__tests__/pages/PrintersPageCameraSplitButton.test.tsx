/**
 * The printer card's camera button chooses its own view mode.
 *
 * Window-vs-overlay used to be one switch in Settings > General > Camera, so
 * watching one printer in an overlay and another in its own window meant a trip
 * to another page and back. The button is now a split control: the icon opens
 * whichever mode was used last, the caret picks between the two. The stored
 * setting survives only as the default a browser that has never chosen starts
 * from -- the local choice wins after that, because a user without
 * settings:update cannot write theirs back and would otherwise never keep one.
 */
import React from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  screen,
  waitFor,
  fireEvent,
  act,
  within,
} from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

const permissions = { granted: ['camera:view', 'settings:update'] as string[] };

const mockUseAuth = {
  user: { id: 1, username: 'operator', permissions: [] as string[] },
  authEnabled: true,
  requiresSetup: false,
  loading: false,
  isAdmin: false,
  login: vi.fn(),
  loginWithToken: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  refreshAuth: vi.fn(),
  hasPermission: vi.fn((permission: string) =>
    permissions.granted.includes(permission)
  ),
  hasAnyPermission: vi.fn(() => true),
  hasAllPermissions: vi.fn(() => true),
  canModify: vi.fn(() => true),
};

vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../contexts/AuthContext')>();
  return { ...actual, useAuth: () => mockUseAuth };
});

import { render } from '../utils';
import { PrintersPage } from '../../pages/PrintersPage';

const mockPrinter = {
  id: 1,
  name: 'X1C',
  ip_address: '192.168.1.100',
  serial_number: '01P00A000000001',
  access_code: '12345678',
  model: 'X1C',
  enabled: true,
  nozzle_diameter: 0.4,
  nozzle_type: 'stainless_steel',
  location: 'Workshop',
  auto_archive: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

/** Bodies of every PUT /settings the page made, so the write-back is checkable. */
const settingsWrites: Record<string, unknown>[] = [];

function renderPage(storedMode: 'window' | 'embedded' = 'window') {
  server.use(
    http.get('/api/v1/printers/', () => HttpResponse.json([mockPrinter])),
    http.get('/api/v1/printers/:id/status', () =>
      HttpResponse.json({
        connected: true,
        state: 'IDLE',
        progress: 0,
        layer_num: 0,
        total_layers: 0,
        temperatures: { nozzle: 25, bed: 25, chamber: 25 },
        remaining_time: 0,
        filename: null,
        wifi_signal: -29,
        speed_level: 2,
        vt_tray: [],
        ams: [],
      })
    ),
    http.get('/api/v1/queue/', () => HttpResponse.json([])),
    http.get('/api/v1/settings/ui-preferences', () =>
      HttpResponse.json({ camera_view_mode: storedMode })
    ),
    http.put('/api/v1/settings/', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      settingsWrites.push(body);
      return HttpResponse.json(body);
    })
  );
  return render(<PrintersPage />);
}

/** The camera icon, whichever of the two modes it currently promises. */
async function cameraIcon(): Promise<HTMLElement> {
  await waitFor(() =>
    expect(document.getElementById('printer-card-1')).not.toBeNull()
  );
  const el =
    screen.queryByTitle('Open camera in new window') ??
    screen.queryByTitle('Open camera overlay');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

async function openModeMenu(): Promise<void> {
  await cameraIcon();
  fireEvent.click(screen.getByLabelText('Camera View Mode'));
}

let openSpy: ReturnType<typeof vi.spyOn>;

/**
 * A real store behind the suite-wide localStorage mock, which is otherwise a
 * set of no-op vi.fn()s -- so setItem would be forgotten and getItem would hand
 * back undefined, and "remembers the choice" could not be tested at all.
 */
const storage = new Map<string, string>();

describe('PrintersPage — camera split button', () => {
  it.each([
    [true, true, false],
    [true, false, false],
    [false, true, false],
    [false, false, false],
    [true, true, true],
  ])(
    'restores independent stock=%s Additional=%s minimized=%s intent after navigation',
    async (stock, additional, minimized) => {
      localStorage.setItem(
        'openEmbeddedCameras',
        JSON.stringify([{ id: 1, name: 'X1C' }])
      );
      localStorage.setItem(
        'embeddedCameraState_1',
        JSON.stringify({ x: 80, y: 90, width: 400, height: 300 })
      );
      localStorage.setItem(
        'embeddedCameraState_additional:1',
        JSON.stringify({ x: 260, y: 180, width: 450, height: 350 })
      );
      window.history.replaceState({}, '', '/printers');
      server.use(
        http.get('*/api/v1/printers/:id/status', () =>
          HttpResponse.json({
            connected: true,
            state: 'IDLE',
            vt_tray: [],
            ams: [],
            temperatures: { nozzle: 25, bed: 25 },
            speed_level: 2,
          })
        ),
        http.get('*/api/v1/printers/:id/additional-camera/status', () =>
          HttpResponse.json({
            configured: true,
            enabled: true,
            friendly_name: 'Overhead',
            frames_recent: true,
          })
        ),
        http.post('*/api/v1/printers/camera/stream-token', () =>
          HttpResponse.json({ token: 'token' })
        )
      );
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      render(
        <>
          <Link to="/settings">Test settings</Link>
          <Link to="/printers">Test printers</Link>
          <Routes>
            <Route path="/printers" element={<PrintersPage />} />
            <Route path="/settings" element={<div>Test settings page</div>} />
          </Routes>
        </>
      );
      const open = () =>
        act(() => {
          window.dispatchEvent(
            new CustomEvent('bambuddy:additional-camera-test', {
              detail: { printerId: 1, mode: 'embedded' },
            })
          );
        });
      open();
      const overlay = await screen.findByRole('region', {
        name: 'Additional Camera overlay',
      });
      const extraImage = await within(overlay).findByRole('img');
      const stockImage = screen
        .getAllByRole('img')
        .find((img) => img.getAttribute('src')?.includes('/camera/stream'))!;
      const stockOverlay = stockImage.closest('.fixed') as HTMLElement;
      if (!additional) fireEvent.click(within(overlay).getByTitle('Close'));
      else if (minimized)
        fireEvent.click(within(overlay).getByTitle('Minimize'));
      if (!stock) fireEvent.click(within(stockOverlay).getByTitle('Close'));
      else if (minimized)
        fireEvent.click(within(stockOverlay).getByTitle('Minimize'));
      const stopCount = () =>
        fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('/camera/stop')
        ).length;
      const before = stopCount();
      fireEvent.click(screen.getByText('Test settings'));
      expect(
        screen.queryByRole('region', { name: 'Additional Camera overlay' })
      ).toBeNull();
      expect(screen.queryByTitle('Expand')).toBeNull();
      expect(extraImage.getAttribute('src')).toBeNull();
      expect(stopCount() - before).toBe(stock ? 1 : 0);
      const after = stopCount();
      fireEvent.click(screen.getByText('Test printers'));
      if (additional) {
        const restored = await screen.findByRole('region', {
          name: 'Additional Camera overlay',
        });
        const img = await within(restored).findByRole('img');
        expect(img).not.toBe(extraImage);
        expect(img.getAttribute('src')).toContain('/additional-camera/stream');
        expect(restored).toHaveStyle({
          left: '260px',
          top: '180px',
          width: '450px',
          height: '350px',
        });
        expect(within(restored).getByTitle('Minimize')).toBeInTheDocument();
      } else
        expect(
          screen.queryByRole('region', { name: 'Additional Camera overlay' })
        ).toBeNull();
      const restoredStock = screen
        .queryAllByRole('img')
        .find((img) => img.getAttribute('src')?.includes('/camera/stream'));
      if (stock) {
        expect(restoredStock).toBeDefined();
        expect(restoredStock).not.toBe(stockImage);
        expect(restoredStock!.closest('.fixed')).toHaveStyle({
          left: '80px',
          top: '90px',
          width: '400px',
          height: '300px',
        });
      } else expect(restoredStock).toBeUndefined();
      expect(stopCount()).toBe(after);
      window.history.replaceState({}, '', '/');
    }
  );

  beforeEach(() => {
    settingsWrites.length = 0;
    permissions.granted = ['camera:view', 'settings:update'];
    storage.clear();
    vi.mocked(localStorage.getItem).mockImplementation(
      (key: string) => storage.get(key) ?? null
    );
    vi.mocked(localStorage.setItem).mockImplementation(
      (key: string, value: string) => {
        storage.set(key, value);
      }
    );
    vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
      storage.delete(key);
    });
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens a separate window when that is the mode in effect', async () => {
    renderPage('window');
    fireEvent.click(await cameraIcon());

    expect(openSpy).toHaveBeenCalledWith(
      '/camera/1',
      'camera-1',
      expect.stringContaining('width=640')
    );
  });

  it('offers both modes from the caret', async () => {
    renderPage('window');
    await openModeMenu();

    expect(await screen.findByText(/New Window/)).toBeInTheDocument();
    expect(await screen.findByText(/Embedded Overlay/)).toBeInTheDocument();
  });

  it('opens the overlay when the overlay is picked, instead of a window', async () => {
    renderPage('window');
    await openModeMenu();
    fireEvent.click(await screen.findByText(/Embedded Overlay/));

    // "Refresh stream" is the overlay's own control; the card has no such button.
    expect(await screen.findByTitle('Refresh stream')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('remembers the picked mode for the next visit', async () => {
    renderPage('window');
    await openModeMenu();
    fireEvent.click(await screen.findByText(/Embedded Overlay/));

    await waitFor(() => expect(storage.get('cameraViewMode')).toBe('embedded'));
  });

  it('uses a remembered choice over the stored setting', async () => {
    // The case that makes the local choice authoritative: the install-wide
    // default still says window, but this browser has asked for the overlay.
    storage.set('cameraViewMode', 'embedded');
    renderPage('window');
    fireEvent.click(await cameraIcon());

    expect(await screen.findByTitle('Refresh stream')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('falls back to the stored setting in a browser that has never chosen', async () => {
    renderPage('embedded');
    await waitFor(() =>
      expect(screen.queryByTitle('Open camera overlay')).not.toBeNull()
    );
    fireEvent.click(await cameraIcon());

    expect(await screen.findByTitle('Refresh stream')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('marks which mode the plain icon will use', async () => {
    storage.set('cameraViewMode', 'embedded');
    renderPage('window');
    await openModeMenu();

    expect(await screen.findByText('Embedded Overlay ✓')).toBeInTheDocument();
    expect(await screen.findByText('New Window')).toBeInTheDocument();
  });

  it('saves the pick as the install-wide default when allowed to', async () => {
    renderPage('window');
    await openModeMenu();
    fireEvent.click(await screen.findByText(/Embedded Overlay/));

    await waitFor(() =>
      expect(settingsWrites).toEqual([{ camera_view_mode: 'embedded' }])
    );
  });

  it('still applies the pick for a user who cannot write settings', async () => {
    // A viewer has camera:view but not settings:update. Their choice has to
    // stick locally, or the menu would appear to do nothing on the next click.
    permissions.granted = ['camera:view'];
    renderPage('window');
    await openModeMenu();
    fireEvent.click(await screen.findByText(/Embedded Overlay/));

    expect(await screen.findByTitle('Refresh stream')).toBeInTheDocument();
    await waitFor(() => expect(storage.get('cameraViewMode')).toBe('embedded'));
    expect(settingsWrites).toEqual([]);
  });
});
