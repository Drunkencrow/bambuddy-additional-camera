import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { AuxiliaryCameraControls } from '../../components/AuxiliaryCameraControls';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const auth = vi.hoisted(() => ({ loading: false, authEnabled: true, user: { id: 3 }, hasPermission: vi.fn(() => true) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
let client: QueryClient;
let states: Record<number, { configured: boolean; enabled: boolean; additional_icon?: string; both_icon?: string }>;
let requests: number[];
const embedded = vi.fn();
const select = vi.fn();
function controls(id: number, connected = true) {
  return <AuxiliaryCameraControls printerId={id} connected={connected} viewMode="window" onSelectViewMode={select} onOpenEmbedded={embedded} />;
}
function mount(children = controls(1)) {
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
beforeEach(() => {
  auth.hasPermission.mockReturnValue(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  states = { 1: { configured: true, enabled: true }, 2: { configured: false, enabled: false } };
  requests = [];
  server.use(
    http.post('*/api/v1/printers/camera/stream-token', () => HttpResponse.json({ token: 'card-token' })),
    http.get('*/api/v1/printers/:id/additional-camera/status', ({ params }) => {
      const id = Number(params.id); requests.push(id);
      return HttpResponse.json(states[id]);
    }),
  );
  embedded.mockClear(); select.mockClear();
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

describe('Additional/Both printer-card availability', () => {
  it('updates on disable, enable, delete, and recreate without changing the printer', async () => {
    mount();
    await screen.findByLabelText('Additional Camera');
    for (const state of [
      { configured: true, enabled: false }, { configured: true, enabled: true },
      { configured: false, enabled: false }, { configured: true, enabled: true },
    ]) {
      states[1] = state;
      await act(async () => { await client.invalidateQueries({ queryKey: ['additional-camera-viewer-status'] }); });
      await waitFor(() => {
        expect(!!screen.queryByLabelText('Additional Camera')).toBe(state.enabled && state.configured);
        expect(!!screen.queryByLabelText('Both Cameras')).toBe(state.enabled && state.configured);
      });
    }
  });

  it('keeps multiple printers independent and deduplicates repeated card renders', async () => {
    const view = mount(<>{controls(1)}{controls(2)}</>);
    await screen.findByLabelText('Additional Camera');
    await waitFor(() => expect(requests).toEqual(expect.arrayContaining([1, 2])));
    expect(screen.getAllByLabelText('Both Cameras')).toHaveLength(1);
    view.rerender(<QueryClientProvider client={client}>{controls(1)}{controls(2)}{controls(1)}</QueryClientProvider>);
    expect(screen.getAllByLabelText('Both Cameras')).toHaveLength(2);
    expect(requests.filter((id) => id === 1)).toHaveLength(1);
  });

  it('does not request status or launch viewers without camera permission', async () => {
    auth.hasPermission.mockReturnValue(false);
    mount();
    await act(async () => {});
    expect(requests).toEqual([]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(embedded).not.toHaveBeenCalled();
  });

  it('matches Stock disconnected gating on both halves of each control', async () => {
    mount(controls(1, false));
    await screen.findByLabelText('Additional Camera');
    screen.getAllByRole('button').forEach((button) => {
      expect(button).toBeDisabled(); fireEvent.click(button);
    });
    expect(embedded).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });

  it('fails closed when availability cannot be read', async () => {
    server.use(http.get('*/api/v1/printers/:id/additional-camera/status', () => new HttpResponse(null, { status: 403 })));
    mount();
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['additional-camera-viewer-status'] })[0]?.state.status).toBe('error'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renews a rejected availability token locally without invalidating the shared token', async () => {
    let minted = 0;
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', () => HttpResponse.json({ token: ++minted === 1 ? 'expired' : 'renewed' })),
      http.get('*/api/v1/printers/:id/additional-camera/status', ({ request }) =>
        new URL(request.url).searchParams.get('token') === 'renewed'
          ? HttpResponse.json(states[1]) : new HttpResponse(null, { status: 401 })),
    );
    mount();
    await screen.findByLabelText('Both Cameras');
    expect(minted).toBe(2);
    expect(client.getQueryData(['camera-stream-token', 3])).toEqual({ token: 'expired' });
  });

  it('bounds automatic renewal when the replacement token is also rejected', async () => {
    let minted = 0;
    server.use(
      http.post('*/api/v1/printers/camera/stream-token', () => HttpResponse.json({ token: `rejected-${++minted}` })),
      http.get('*/api/v1/printers/:id/additional-camera/status', () => new HttpResponse(null, { status: 401 })),
    );
    mount();
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['additional-camera-viewer-status'] })
      .some((query) => query.queryKey.at(-1) === 'rejected-2' && query.state.status === 'error')).toBe(true));
    expect(minted).toBe(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('resolves configured artwork and preserves the button and open menu during icon updates', async () => {
    states[1] = { configured: true, enabled: true, additional_icon: 'overhead', both_icon: 'overlapping-cameras' };
    mount();
    const additional = await screen.findByLabelText('Additional Camera');
    const both = screen.getByLabelText('Both Cameras');
    expect(additional.querySelector('svg')).toHaveAttribute('data-camera-icon', 'overhead');
    expect(both.querySelector('svg')).toHaveAttribute('data-camera-icon', 'overlapping-cameras');
    const classes = additional.className;
    fireEvent.click(screen.getByLabelText('Additional Camera — Camera View Mode'));
    expect(screen.getByText('Embedded Overlay')).toBeInTheDocument();
    states[1] = { configured: true, enabled: true, additional_icon: '__proto__', both_icon: 'constructor' };
    await act(async () => { await client.invalidateQueries({ queryKey: ['additional-camera-viewer-status'] }); });
    expect(screen.getByLabelText('Additional Camera')).toBe(additional);
    expect(additional.className).toBe(classes);
    await waitFor(() => expect(additional.querySelector('svg')).toHaveAttribute('data-camera-icon', 'additional'));
    expect(both.querySelector('svg')).toHaveAttribute('data-camera-icon', 'both');
    expect(screen.getByText('Embedded Overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Embedded Overlay'));
    expect(embedded).toHaveBeenCalledWith('additional', 1);
  });

  it('has no production Console launcher or event listener', () => {
    function sourceFiles(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.name === '__tests__' ? [] : entry.isDirectory() ? sourceFiles(resolve(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [resolve(dir, entry.name)] : []);
    }
    for (const file of sourceFiles(resolve('src'))) {
      expect(readFileSync(file, 'utf8')).not.toContain('bambuddy:additional-camera-test');
    }
  });
});
