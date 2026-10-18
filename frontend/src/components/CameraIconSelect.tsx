import { useEffect, useId, useRef, useState, type ComponentType, type ComponentProps } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CAMERA_ICON_LABEL_KEYS, AdditionalCameraIcon } from './AuxiliaryCameraIcons';

/** Compact SVG select, following Bambuddy's SlotPicker combobox pattern. */
export function CameraIconSelect({ label, icons, value, onChange }: {
  label: string;
  icons: Record<string, ComponentType<ComponentProps<typeof AdditionalCameraIcon>>>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const entries = Object.entries(icons);
  const selected = Math.max(0, entries.findIndex(([key]) => key === value));
  const [selectedId, SelectedIcon] = entries[selected];
  const name = (key: string) => t(CAMERA_ICON_LABEL_KEYS[key as keyof typeof CAMERA_ICON_LABEL_KEYS]);
  const choose = (index: number) => {
    onChange(entries[index][0]);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="relative w-full text-sm" ref={root}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label id={`${id}-label`} htmlFor={id} className="block">{label}</label>
      <button ref={trigger} id={id} type="button" role="combobox" aria-labelledby={`${id}-label`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        className="w-full flex items-center gap-2 px-3 py-2 bg-bambu-dark-tertiary border border-bambu-dark-tertiary rounded-lg text-white text-left hover:border-bambu-gray focus:outline-none focus:ring-2 focus:ring-bambu-green disabled:opacity-50"
        onClick={() => { setActive(selected); setOpen(!open); }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
              : !open ? selected : (active + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
            setActive(next); setOpen(true);
            requestAnimationFrame(() => document.getElementById(`${id}-option-${next}`)?.scrollIntoView?.({ block: 'nearest' }));
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(active); else { setActive(selected); setOpen(true); }
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          } else if (event.key === 'Tab') setOpen(false);
        }}>
        <SelectedIcon className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 truncate">{name(selectedId)}</span>
        <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 text-bambu-gray shrink-0" />
      </button>
      {open && <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}
        className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto p-1 bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded-lg shadow-xl">
        {entries.map(([key, Icon], index) => <div key={key} id={`${id}-option-${index}`} role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => setActive(index)} onClick={() => choose(index)}
          className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm cursor-pointer text-white hover:bg-bambu-dark-tertiary ${index === active ? 'bg-bambu-dark-tertiary outline outline-1 outline-bambu-green' : ''}`}>
          <Icon className="w-4 h-4 shrink-0" /><span className="flex-1">{name(key)}</span>
          {index === selected && <Check aria-hidden="true" className="w-4 h-4 shrink-0" />}
        </div>)}
      </div>}
    </div>
  );
}
