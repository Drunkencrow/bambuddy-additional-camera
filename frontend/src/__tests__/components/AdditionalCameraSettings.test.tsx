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
  additional_icon: 'camera-plus' as const,
  both_icon: 'dual-camera' as const,
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
      additional_icon: 'camera-plus',
      both_icon: 'dual-camera',
      friendly_name: 'Side view',
      enabled: true,
      camera_type: 'rtsp',
      camera_url: 'rtsp://cam/live',
      snapshot_url: null,
      rotation: 90,
    });
  });

  it('scopes responsive columns to each configured card and keeps URL fields and actions full width', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => ({ ...saved, printer_id: id }));
    renderSettings();
    for (const name of ['Printer one', 'Printer two']) {
      const region = await screen.findByRole('region', { name });
      const card = within(region);
      const friendly = card.getByLabelText('Friendly Name');
      const enabled = card.getByLabelText('Enabled');
      const type = card.getByLabelText('Camera Type');
      const top = friendly.closest('label')!.parentElement!.parentElement!;
      expect(top).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-4');
      expect(enabled.closest('label')!.parentElement).toBe(friendly.closest('label')!.parentElement);
      expect(type.closest('label')!.parentElement).toBe(top);
      const rotation = card.getByLabelText('Rotation');
      const lower = rotation.closest('label')!.parentElement!;
      expect(lower).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2');
      const additional = card.getByRole('combobox', { name: 'additionalCameras.additionalIcon' });
      const both = card.getByRole('combobox', { name: 'additionalCameras.bothIcon' });
      expect(additional.parentElement!.parentElement).toBe(both.parentElement!.parentElement);
      expect(additional.parentElement!.parentElement!.parentElement).toBe(lower);
      const fields = region.querySelector('fieldset');
      expect(card.getByLabelText('Camera URL').closest('label')!.parentElement).toBe(fields);
      expect(card.getByLabelText('Snapshot URL (optional)').closest('label')!.parentElement).toBe(fields);
      const actions = card.getByRole('button', { name: 'Save' }).parentElement!;
      expect(actions.parentElement).toBe(fields);
      expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Test Camera', 'Save', 'Remove Camera']);
    }
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


describe('Camera icon pickers', () => {
  it('uses independent dropdowns, saves both values, and reloads persisted selections', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => id === 1 ? saved : null);
    const persisted = { ...saved, additional_icon: 'webcam' as const, both_icon: 'side-by-side' as const };
    vi.mocked(api.saveAdditionalCamera).mockResolvedValue(persisted);
    renderSettings();
    const card = within(await screen.findByRole('region', { name: 'Printer one' }));

    const additional = card.getByRole('combobox', { name: 'additionalCameras.additionalIcon' });
    const both = card.getByRole('combobox', { name: 'additionalCameras.bothIcon' });
    expect(additional).toHaveTextContent('additionalCameras.icons.cameraPlus'); expect(both).toHaveTextContent('additionalCameras.icons.dualCamera');

    for (const [control, count] of [[additional, 7], [both, 4]] as const) {
      fireEvent.click(control);
      const options = within(card.getByRole('listbox')).getAllByRole('option');
      expect(options).toHaveLength(count);
      options.forEach((option) => {
        expect(option.querySelector('svg')).toBeTruthy();
        expect(option).toHaveTextContent('additionalCameras.icons.');
      });
      fireEvent.keyDown(control, { key: 'Escape' });
    }
    fireEvent.click(card.getByRole('combobox', { name: 'additionalCameras.additionalIcon' }));
    fireEvent.click(card.getByRole('option', { name: 'additionalCameras.icons.webcam' }));
    expect(both).toHaveTextContent('additionalCameras.icons.dualCamera');
    fireEvent.click(card.getByRole('combobox', { name: 'additionalCameras.bothIcon' }));
    fireEvent.click(card.getByRole('option', { name: 'additionalCameras.icons.sideBySide' }));
    fireEvent.change(card.getByLabelText('Friendly Name'), { target: { value: 'New name' } });
    fireEvent.click(card.getByRole('button', { name: 'Save' }));
    await card.findByText('Additional Camera saved');
    expect(api.saveAdditionalCamera).toHaveBeenCalledWith(1, expect.objectContaining({ additional_icon: 'webcam', both_icon: 'side-by-side' }));
    // A newly mounted page reads the persisted response.
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => id === 1 ? persisted : null);
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    renderSettings();
    const reloaded = within(await screen.findByRole('region', { name: 'Printer one' }));
    expect(reloaded.getByRole('combobox', { name: 'additionalCameras.additionalIcon' })).toHaveTextContent('additionalCameras.icons.webcam');
    expect(reloaded.getByRole('combobox', { name: 'additionalCameras.bothIcon' })).toHaveTextContent('additionalCameras.icons.sideBySide');
  });

  it('supports keyboard selection, cancellation and Tab focus', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    await selectPrinter();
    const additional = screen.getByRole('combobox', { name: 'additionalCameras.additionalIcon' });
    const both = screen.getByRole('combobox', { name: 'additionalCameras.bothIcon' });
    additional.focus();
    await user.keyboard(' {ArrowDown}{Enter}');
    expect(additional).toHaveTextContent('additionalCameras.icons.videoPlus');
    expect(additional).toHaveFocus();
    await user.keyboard('{Enter}{End}{Escape}');
    expect(additional).toHaveTextContent('additionalCameras.icons.videoPlus');
    expect(additional).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}{Home}{ArrowUp}{Enter}');
    expect(additional).toHaveTextContent('additionalCameras.icons.boardCamera');
    await user.keyboard('{Enter}{Tab}');
    expect(additional).toHaveAttribute('aria-expanded', 'false');
    expect(both).toHaveFocus();
    expect(both).toHaveTextContent('additionalCameras.icons.dualCamera');
    expect(api.saveAdditionalCamera).not.toHaveBeenCalled();
  });

  it('retains icon drafts on failed save and isolates printer groups', async () => {
    vi.mocked(api.getAdditionalCamera).mockImplementation(async (id) => ({ ...saved, printer_id: id }));
    vi.mocked(api.saveAdditionalCamera).mockRejectedValue(new Error('Save failed'));
    renderSettings();
    const first = within(await screen.findByRole('region', { name: 'Printer one' }));
    const second = within(await screen.findByRole('region', { name: 'Printer two' }));
    fireEvent.click(first.getByRole('combobox', { name: 'additionalCameras.additionalIcon' }));
    fireEvent.click(first.getByRole('option', { name: 'additionalCameras.icons.overhead' }));
    fireEvent.click(first.getByRole('combobox', { name: 'additionalCameras.bothIcon' }));
    fireEvent.click(first.getByRole('option', { name: 'additionalCameras.icons.overlappingCameras' }));
    fireEvent.click(first.getByRole('button', { name: 'Save' }));
    await first.findByText('Save failed');
    expect(first.getByRole('combobox', { name: 'additionalCameras.additionalIcon' })).toHaveTextContent('additionalCameras.icons.overhead');
    expect(first.getByRole('combobox', { name: 'additionalCameras.bothIcon' })).toHaveTextContent('additionalCameras.icons.overlappingCameras');
    expect(second.getByRole('combobox', { name: 'additionalCameras.additionalIcon' })).toHaveTextContent('additionalCameras.icons.cameraPlus');
    expect(second.getByRole('combobox', { name: 'additionalCameras.bothIcon' })).toHaveTextContent('additionalCameras.icons.dualCamera');
  });
});
