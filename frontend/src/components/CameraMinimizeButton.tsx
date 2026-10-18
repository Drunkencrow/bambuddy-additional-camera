import { Maximize2, Minimize2 } from 'lucide-react';

export function CameraMinimizeButton({ minimized, onToggle, label }: { minimized: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      onClick={onToggle}
      className="p-1 hover:bg-bambu-dark-tertiary rounded"
      title={label ?? (minimized ? 'Expand' : 'Minimize')}
    >
      {minimized ? (
        <Maximize2 className="w-3.5 h-3.5 text-bambu-gray" />
      ) : (
        <Minimize2 className="w-3.5 h-3.5 text-bambu-gray" />
      )}
    </button>
  );
}
