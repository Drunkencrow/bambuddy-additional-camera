import { useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { AdditionalCamera, AdditionalCameraInput, CameraConnectionTestResult } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader } from './Card';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { registerSettingsSearch } from '../lib/settingsSearch';

registerSettingsSearch({
  labelKey: 'settings.tabs.additionalCameras',
  labelFallback: 'Additional Cameras',
  tab: 'additional-cameras',
  keywords: 'additional camera printer friendly name enabled mjpeg rtsp snapshot usb rotation',
  anchor: 'card-additional-cameras',
});

const empty: AdditionalCameraInput = {
  friendly_name: '',
  enabled: false,
  camera_type: 'mjpeg',
  camera_url: '',
  snapshot_url: null,
  rotation: 0,
};
const inputClass = 'w-full px-3 py-2 bg-bambu-dark-tertiary border border-bambu-dark-tertiary rounded-lg text-white';

function CameraForm({
  printerId,
  initial,
  onSaved,
}: {
  printerId: number;
  initial: AdditionalCamera | null;
  onSaved: (camera: AdditionalCamera | null) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AdditionalCameraInput>(initial ?? empty);
  const [exists, setExists] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [test, setTest] = useState<CameraConnectionTestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const usb = useQuery({ queryKey: ['usb-cameras'], queryFn: api.getUsbCameras, enabled: form.camera_type === 'usb' });
  const change = (values: Partial<AdditionalCameraInput>) => {
    setForm({ ...form, ...values });
    setTest(null);
    setMessage(null);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : t('additionalCameras.error', 'Camera operation failed'),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const saved = await api.saveAdditionalCamera(printerId, form);
            setForm(saved);
            setExists(true);
            onSaved(saved);
            setMessage({ success: true, text: t('additionalCameras.saved', 'Additional Camera saved') });
          });
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm">
            {t('additionalCameras.friendlyName', 'Friendly Name')}
            <input
              className={inputClass}
              value={form.friendly_name}
              maxLength={100}
              required
              onChange={(e) => change({ friendly_name: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
            {t('additionalCameras.enabled', 'Enabled')}
          </label>
          <label className="block text-sm">
            {t('additionalCameras.cameraType', 'Camera Type')}
            <select
              className={inputClass}
              value={form.camera_type}
              onChange={(e) => change({ camera_type: e.target.value as AdditionalCameraInput['camera_type'] })}
            >
              <option value="mjpeg">MJPEG</option>
              <option value="rtsp">RTSP</option>
              <option value="snapshot">Snapshot</option>
              <option value="usb">USB</option>
            </select>
          </label>
          <label className="block text-sm">
            {form.camera_type === 'usb'
              ? t('additionalCameras.usbDevice', 'USB Device')
              : t('additionalCameras.cameraUrl', 'Camera URL')}
            <input
              className={inputClass}
              value={form.camera_url}
              maxLength={500}
              required
              list={form.camera_type === 'usb' ? `additional-camera-usb-${printerId}` : undefined}
              placeholder={
                form.camera_type === 'usb' ? '/dev/video0' : form.camera_type === 'rtsp' ? 'rtsp://…' : 'http://…'
              }
              onChange={(e) => change({ camera_url: e.target.value })}
            />
          </label>
          {form.camera_type === 'usb' && (
            <>
              <datalist id={`additional-camera-usb-${printerId}`}>
                {usb.data?.cameras.map((camera) => (
                  <option key={camera.device} value={camera.device}>
                    {camera.name}
                  </option>
                ))}
              </datalist>
              <Button type="button" variant="secondary" onClick={() => void usb.refetch()} disabled={usb.isFetching}>
                {t('additionalCameras.refreshUsb', 'Refresh USB devices')}
              </Button>
              {usb.isError && (
                <p role="alert" className="text-red-400">
                  {t('additionalCameras.usbError', 'USB discovery failed. You can enter a device path manually.')}
                </p>
              )}
            </>
          )}
          {form.camera_type !== 'snapshot' && (
            <label className="block text-sm">
              {t('additionalCameras.snapshotUrl', 'Snapshot URL (optional)')}
              <input
                className={inputClass}
                value={form.snapshot_url ?? ''}
                maxLength={500}
                onChange={(e) => change({ snapshot_url: e.target.value || null })}
              />
            </label>
          )}
          <label className="block text-sm">
            {t('additionalCameras.rotation', 'Rotation')}
            <select
              className={inputClass}
              value={form.rotation}
              onChange={(e) => change({ rotation: Number(e.target.value) as AdditionalCameraInput['rotation'] })}
            >
              {([0, 90, 180, 270] as const).map((rotation) => (
                <option key={rotation} value={rotation}>
                  {rotation}°
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!form.camera_url.trim()}
              onClick={() =>
                void run(async () => {
                  setTest(null);
                  setTest(
                    await api.testAdditionalCamera(printerId, {
                      camera_type: form.camera_type,
                      camera_url: form.camera_url,
                    }),
                  );
                })
              }
            >
              {t('additionalCameras.test', 'Test Camera')}
            </Button>
            <Button type="submit" disabled={!form.friendly_name.trim() || !form.camera_url.trim()}>
              {t('common.save', 'Save')}
            </Button>
            {exists && (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                {t('additionalCameras.remove', 'Remove Camera')}
              </Button>
            )}
          </div>
        </fieldset>
        {busy && <p role="status">{t('additionalCameras.working', 'Working…')}</p>}
        {test && (
          <p role="status" className={test.success ? 'text-bambu-green' : 'text-red-400'}>
            {test.success
              ? t('additionalCameras.testSuccess', 'Camera connection successful')
              : test.error || t('additionalCameras.testFailure', 'Camera connection failed')}
            {test.resolution && ` (${test.resolution})`}
            {test.coalesced &&
              ` — ${t('additionalCameras.coalesced', 'Shared capture; a new connection was not opened.')}`}
          </p>
        )}
        {message && (
          <p role="status" className={message.success ? 'text-bambu-green' : 'text-red-400'}>
            {message.text}
          </p>
        )}
      </form>
      {confirmDelete && (
        <ConfirmModal
          title={t('additionalCameras.remove', 'Remove Camera')}
          message={t('additionalCameras.removeConfirm', 'Remove this printer’s Additional Camera configuration?')}
          confirmText={t('common.remove', 'Remove')}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void run(async () => {
              await api.deleteAdditionalCamera(printerId);
              setForm(empty);
              setExists(false);
              setTest(null);
              onSaved(null);
              setMessage({ success: true, text: t('additionalCameras.removed', 'Additional Camera removed') });
            });
          }}
        />
      )}
    </>
  );
}

export function AdditionalCameraSettings() {
  const { t } = useTranslation();
  const { authEnabled, hasPermission } = useAuth();
  const canModify = !authEnabled || hasPermission('printers:update');
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printers = useQuery({ queryKey: ['printers'], queryFn: api.getPrinters });
  const queryClient = useQueryClient();
  const cameras = useQueries({
    queries: (printers.data ?? []).map((printer) => ({
      queryKey: ['additional-camera', printer.id],
      queryFn: () => api.getAdditionalCamera(printer.id),
      enabled: canModify,
    })),
  });
  const availablePrinters = (printers.data ?? []).filter((_, index) => cameras[index]?.data === null);
  const configuredPrinters = (printers.data ?? []).filter((_, index) => !!cameras[index]?.data);
  const loading = printers.isLoading || (canModify && cameras.some((camera) => camera.isPending));
  return (
    <Card id="card-additional-cameras">
      <CardHeader>
        <h2 className="text-lg font-semibold">{t('settings.tabs.additionalCameras', 'Additional Cameras')}</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-bambu-gray">
          {t('additionalCameras.description', 'Configure one additional camera per printer.')}
        </p>
        <label className="block text-sm">
          {t('additionalCameras.printer', 'Printer')}
          <select
            className={inputClass}
            value={printerId ?? ''}
            onChange={(e) => setPrinterId(e.target.value ? Number(e.target.value) : null)}
            disabled={!canModify || loading || availablePrinters.length === 0}
          >
            <option value="">
              {!loading && printers.data?.length && configuredPrinters.length === printers.data.length
                ? t('additionalCameras.noAvailablePrinters', 'No remaining printers available to configure')
                : t('additionalCameras.selectPrinter', 'Select a printer')}
            </option>
            {availablePrinters.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name}
              </option>
            ))}
          </select>
        </label>
        {loading && <p role="status">{t('common.loading', 'Loading…')}</p>}
        {printers.isError && <p role="alert">{t('additionalCameras.printersError', 'Failed to load printers')}</p>}
        {printers.data?.length === 0 && (
          <p>{t('additionalCameras.noPrinters', 'Add a printer to configure an additional camera.')}</p>
        )}
        {!canModify && (
          <p role="alert">{t('additionalCameras.permission', 'Printer modification permission is required.')}</p>
        )}
        {canModify && cameras.some((camera) => camera.isError) && (
          <p role="alert">
            {t('additionalCameras.loadError', 'Failed to load camera configuration')}{' '}
            <Button
              variant="secondary"
              onClick={() => {
                cameras.filter((camera) => camera.isError).forEach((camera) => void camera.refetch());
              }}
            >
              {t('common.retry', 'Retry')}
            </Button>
          </p>
        )}
        {configuredPrinters.length > 0 && (
          <h3 className="text-lg font-semibold">
            {t('additionalCameras.configured', 'Configured Additional Cameras')}
          </h3>
        )}
        {canModify &&
          printers.data?.map((printer, index) => {
            const initial = cameras[index]?.data;
            if (!initial && !(initial === null && printer.id === printerId)) return null;
            return (
              <Card key={printer.id} role="region" aria-label={printer.name}>
                <CardHeader>
                  <h3 className="text-lg font-semibold">{printer.name}</h3>
                </CardHeader>
                <CardContent>
                  <CameraForm
                    printerId={printer.id}
                    initial={initial ?? null}
                    onSaved={(saved) => {
                      queryClient.setQueryData(['additional-camera', printer.id], saved);
                      void queryClient.invalidateQueries({ queryKey: ['additional-camera-viewer-status', `additional:${printer.id}`] });
                      if (printerId === printer.id) setPrinterId(null);
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
      </CardContent>
    </Card>
  );
}
