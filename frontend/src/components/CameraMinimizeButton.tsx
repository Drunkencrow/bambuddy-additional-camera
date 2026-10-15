import { Maximize2, Minimize2 } from 'lucide-react';

export function CameraMinimizeButton({ minimized, onToggle }: { minimized: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="p-1 hover:bg-bambu-dark-tertiary rounded"
      title={minimized ? 'Expand' : 'Minimize'}
    >
      {minimized ? (
        <Maximize2 className="w-3.5 h-3.5 text-bambu-gray" />
      ) : (
        <Minimize2 className="w-3.5 h-3.5 text-bambu-gray" />
      )}
    </button>
  );
}
