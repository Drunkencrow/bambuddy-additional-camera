import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function selectPrinter() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdditionalCameraSettings />
    </QueryClientProvider>
  );
  await screen.findByRole('option', { name: 'Printer one' });
  fireEvent.change(screen.getByLabelText('Printer'), { target: { value: '1' } });
  await screen.findByLabelText('Friendly Name');
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
    expect(api.saveAdditionalCamera).toHaveBeenCalledWith(1, {
      friendly_name: 'Side view',
      enabled: true,
      camera_type: 'rtsp',
      camera_url: 'rtsp://cam/live',
      snapshot_url: null,
      rotation: 90,
    });
  });

  it('loads, edits, removes, and clears the form when switching printers', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => (id === 1 ? saved : null));
    await selectPrinter();
    expect(screen.getByLabelText('Friendly Name')).toHaveValue('Side view');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText('Additional Camera removed');
    expect(api.deleteAdditionalCamera).toHaveBeenCalledWith(1);
    expect(api.saveAdditionalCamera).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Friendly Name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Printer'), { target: { value: '2' } });
    await waitFor(() => expect(api.getAdditionalCamera).toHaveBeenCalledWith(2));
    expect(await screen.findByLabelText('Friendly Name')).toHaveValue('');
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
