import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdditionalCameraSettings } from '../../components/AdditionalCameraSettings';
import { api } from '../../api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ authEnabled: false, hasPermission: () => true }) }));
vi.mock('../../api/client', () => ({
  api: {
    getPrinters: vi.fn(),
    getAdditionalCamera: vi.fn(),
    saveAdditionalCamera: vi.fn(),
    deleteAdditionalCamera: vi.fn(),
    testAdditionalCamera: vi.fn(),
    getUsbCameras: vi.fn(),
  },
}));

const saved = {
  id: 1,
  printer_id: 1,
  friendly_name: 'Side view',
  enabled: true,
  camera_type: 'rtsp' as const,
  camera_url: 'rtsp://cam/live',
  snapshot_url: null,
  rotation: 90 as const,
  created_at: '',
  updated_at: '',
};

function renderSettings() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdditionalCameraSettings />
    </QueryClientProvider>,
  );
}

async function selectPrinter() {
  renderSettings();
  await screen.findByRole('option', { name: 'Printer one' });
  fireEvent.change(screen.getByLabelText('Printer'), { target: { value: '1' } });
  await screen.findByLabelText('Friendly Name');
  expect(api.saveAdditionalCamera).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getPrinters).mockResolvedValue([
    { id: 1, name: 'Printer one' },
    { id: 2, name: 'Printer two' },
  ] as Awaited<ReturnType<typeof api.getPrinters>>);
  vi.mocked(api.getAdditionalCamera).mockResolvedValue(null);
  vi.mocked(api.saveAdditionalCamera).mockResolvedValue(saved);
  vi.mocked(api.getUsbCameras).mockResolvedValue({
    cameras: [{ device: '/dev/video0', name: 'USB camera', capabilities: ['capture'] }],
  });
});

describe('AdditionalCameraSettings', () => {
  it('tests unsaved values and saves separate camera configuration', async () => {
    vi.mocked(api.testAdditionalCamera).mockResolvedValue({ success: true, resolution: '640x480', coalesced: true });
    await selectPrinter();
    fireEvent.change(screen.getByLabelText('Friendly Name'), { target: { value: 'Side view' } });
    fireEvent.change(screen.getByLabelText('Camera URL'), { target: { value: 'rtsp://cam/live' } });
    fireEvent.change(screen.getByLabelText('Camera Type'), { target: { value: 'rtsp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Camera' }));
    await screen.findByText(/Camera connection successful/);
    expect(api.testAdditionalCamera).toHaveBeenCalledWith(1, { camera_type: 'rtsp', camera_url: 'rtsp://cam/live' });
    expect(screen.getByText(/Shared capture/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enabled'));
    fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Additional Camera saved');
    expect(screen.getByRole('region', { name: 'Printer one' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Printer one' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Printer two' })).toBeTruthy();
    expect(screen.getByLabelText('Friendly Name')).toHaveValue(saved.friendly_name);
    expect(api.saveAdditionalCamera).toHaveBeenCalledWith(1, {
      friendly_name: 'Side view',
      enabled: true,
      camera_type: 'rtsp',
      camera_url: 'rtsp://cam/live',
      snapshot_url: null,
      rotation: 90,
    });
  });

  it('renders configured cards, filters the selector, and returns removed printers immediately', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => (id === 1 ? saved : null));
    renderSettings();
    const card = within(await screen.findByRole('region', { name: 'Printer one' }));
    expect(card.getByLabelText('Friendly Name')).toHaveValue('Side view');
    expect(screen.queryByRole('option', { name: 'Printer one' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Printer two' })).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Remove Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Printer one' })).toBeNull());
    expect(screen.getByRole('option', { name: 'Printer one' })).toBeTruthy();
    expect(api.deleteAdditionalCamera).toHaveBeenCalledWith(1);
    expect(api.saveAdditionalCamera).not.toHaveBeenCalled();
  });

  it('keeps multiple cards and their edits, enabled values, tests, and USB lists independent', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => ({
      ...saved,
      printer_id: id,
      friendly_name: id === 1 ? 'Side view' : 'Overhead',
      enabled: id === 1,
    }));
    vi.mocked(api.testAdditionalCamera).mockResolvedValue({ success: true });
    renderSettings();
    const first = within(await screen.findByRole('region', { name: 'Printer one' }));
    const second = within(await screen.findByRole('region', { name: 'Printer two' }));
    expect(screen.getByLabelText('Printer')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'No remaining printers available to configure' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Printer one' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Printer two' })).toBeNull();
    fireEvent.change(first.getByLabelText('Friendly Name'), { target: { value: 'Draft one' } });
    fireEvent.click(first.getByLabelText('Enabled'));
    expect(second.getByLabelText('Friendly Name')).toHaveValue('Overhead');
    expect(second.getByLabelText('Enabled')).not.toBeChecked();
    fireEvent.click(second.getByLabelText('Enabled'));
    expect(first.getByLabelText('Enabled')).not.toBeChecked();
    fireEvent.change(first.getByLabelText('Camera URL'), { target: { value: 'rtsp://draft/live' } });
    fireEvent.click(first.getByRole('button', { name: 'Test Camera' }));
    await waitFor(() =>
      expect(api.testAdditionalCamera).toHaveBeenCalledWith(1, {
        camera_type: 'rtsp',
        camera_url: 'rtsp://draft/live',
      }),
    );
    expect(second.queryByText('Camera connection successful')).toBeNull();
    fireEvent.change(second.getByLabelText('Friendly Name'), { target: { value: 'Draft two' } });
    fireEvent.click(first.getByRole('button', { name: 'Save' }));
    await first.findByText('Additional Camera saved');
    expect(second.getByLabelText('Friendly Name')).toHaveValue('Draft two');
    expect(second.getByLabelText('Enabled')).toBeChecked();
    fireEvent.change(first.getByLabelText('Camera Type'), { target: { value: 'usb' } });
    fireEvent.change(second.getByLabelText('Camera Type'), { target: { value: 'usb' } });
    await first.findByText('USB camera');
    await second.findByText('USB camera');
    expect(first.getByLabelText('USB Device').getAttribute('list')).toBe('additional-camera-usb-1');
    expect(second.getByLabelText('USB Device').getAttribute('list')).toBe('additional-camera-usb-2');
  });

  it('keeps unsaved printers available when saving fails', async () => {
    vi.mocked(api.saveAdditionalCamera).mockRejectedValue(new Error('Save failed'));
    await selectPrinter();
    fireEvent.change(screen.getByLabelText('Friendly Name'), { target: { value: 'Draft' } });
    fireEvent.change(screen.getByLabelText('Camera URL'), { target: { value: 'http://cam/live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Save failed');
    expect(screen.queryByText('Configured Additional Cameras')).toBeNull();
    expect(screen.getByRole('option', { name: 'Printer one' })).toBeTruthy();
    expect(screen.getByLabelText('Friendly Name')).toHaveValue('Draft');
  });

  it('keeps configured cards when removal fails', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => (id === 1 ? saved : null));
    vi.mocked(api.deleteAdditionalCamera).mockRejectedValue(new Error('Remove failed'));
    renderSettings();
    const card = within(await screen.findByRole('region', { name: 'Printer one' }));
    fireEvent.click(card.getByRole('button', { name: 'Remove Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await card.findByText('Remove failed');
    expect(card.getByLabelText('Friendly Name')).toHaveValue('Side view');
    expect(screen.queryByRole('option', { name: 'Printer one' })).toBeNull();
  });

  it('discovers USB devices and displays test failure', async () => {
    vi.mocked(api.testAdditionalCamera).mockResolvedValue({ success: false, error: 'Connection failed: TimeoutError' });
    await selectPrinter();
    fireEvent.change(screen.getByLabelText('Camera Type'), { target: { value: 'usb' } });
    await waitFor(() => expect(api.getUsbCameras).toHaveBeenCalled());
    expect(await screen.findByText('USB camera')).toHaveValue('/dev/video0');
    fireEvent.change(screen.getByLabelText('USB Device'), { target: { value: '/dev/video0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Camera' }));
    await screen.findByText('Connection failed: TimeoutError');
    fireEvent.change(screen.getByLabelText('Camera Type'), { target: { value: 'snapshot' } });
    expect(screen.queryByLabelText('Snapshot URL (optional)')).toBeNull();
  });
});
