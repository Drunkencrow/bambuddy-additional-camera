interface AuxiliaryCameraIconProps {
  className?: string;
}

/** A video camera with a small, unbadged plus inside its body. */
export function AdditionalCameraIcon({ className }: AuxiliaryCameraIconProps) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-camera-icon="additional">
      <rect x="2" y="6" width="13" height="12" rx="2" />
      <path d="m15 10 7-4v12l-7-4M6 12h5M8.5 9.5v5" />
    </svg>
  );
}

/** Two diagonally offset video cameras, separated to stay clear at 16px. */
export function BothCamerasIcon({ className }: AuxiliaryCameraIconProps) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-camera-icon="both">
      <rect x="7" y="3" width="10" height="7" rx="1.5" />
      <path d="m17 5 5-2v7l-5-2" />
      <rect x="2" y="14" width="10" height="7" rx="1.5" />
      <path d="m12 16 5-2v7l-5-2" />
    </svg>
  );
}
