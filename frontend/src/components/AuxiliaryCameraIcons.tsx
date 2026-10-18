import type { ComponentType, ReactNode } from 'react';

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

function Outline({ className, name, children }: AuxiliaryCameraIconProps & { name: string; children: ReactNode }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" data-camera-icon={name}>{children}</svg>;
}

export function VideoPlusIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="video-plus"><rect x="2" y="10" width="12" height="11" rx="2" /><path d="m14 14 7-3v9l-7-3M18 2v5M15.5 4.5h5" /></Outline>;
}
export function OverheadCameraIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="overhead"><path d="M5 2h14M12 2v5" /><rect x="5" y="7" width="14" height="8" rx="2" /><path d="m8 15 1 6h6l1-6" /></Outline>;
}
export function ChamberCameraIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="chamber"><path d="M2 21V3h20v18" /><rect x="6" y="8" width="12" height="10" rx="2" /><circle cx="12" cy="13" r="3" /></Outline>;
}
export function WebcamIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="webcam"><rect x="2" y="4" width="20" height="12" rx="5" /><circle cx="12" cy="10" r="3" /><path d="M12 16v5M7 21h10" /></Outline>;
}
export function SecurityCameraIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="security-camera"><path d="m3 4 18 5-4 8-14-5 2-7M18 9l-3 7M10 15l-2 5H2M2 17v5" /></Outline>;
}
export function BoardCameraIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="board-camera"><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="12" r="4" /><path d="M2 8h3M2 16h3M19 8h3M19 16h3" /></Outline>;
}
export function OverlappingCamerasIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="overlapping-cameras"><path d="M5 15H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3l1-2h5l1 2h2a2 2 0 0 1 2 2" /><path d="m11 8 1-2h5l1 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" /><circle cx="14.5" cy="15" r="3.5" /></Outline>;
}
export function SideBySideCamerasIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="side-by-side"><path d="m3 7 1-2h3l1 2M16 7l1-2h3l1 2" /><rect x="1" y="7" width="9" height="12" rx="2" /><rect x="14" y="7" width="9" height="12" rx="2" /><circle cx="5.5" cy="13" r="2" /><circle cx="18.5" cy="13" r="2" /></Outline>;
}
export function SplitCameraViewIcon(props: AuxiliaryCameraIconProps) {
  return <Outline {...props} name="split-camera-view"><rect x="1" y="3" width="22" height="16" rx="2" /><path d="M12 3v16M12 19v3M8 22h8" /><circle cx="6.5" cy="11" r="3" /><circle cx="17.5" cy="11" r="3" /></Outline>;
}

export const ADDITIONAL_CAMERA_ICONS = {
  'camera-plus': AdditionalCameraIcon,
  'video-plus': VideoPlusIcon,
  overhead: OverheadCameraIcon,
  chamber: ChamberCameraIcon,
  webcam: WebcamIcon,
  'security-camera': SecurityCameraIcon,
  'board-camera': BoardCameraIcon,
} as const satisfies Record<string, ComponentType<AuxiliaryCameraIconProps>>;
export const BOTH_CAMERA_ICONS = {
  'dual-camera': BothCamerasIcon,
  'overlapping-cameras': OverlappingCamerasIcon,
  'side-by-side': SideBySideCamerasIcon,
  'split-camera-view': SplitCameraViewIcon,
} as const satisfies Record<string, ComponentType<AuxiliaryCameraIconProps>>;
export type AdditionalCameraIconId = keyof typeof ADDITIONAL_CAMERA_ICONS;
export type BothCameraIconId = keyof typeof BOTH_CAMERA_ICONS;

// Resolvers intentionally live alongside this fixed artwork registry.
// eslint-disable-next-line react-refresh/only-export-components
export function resolveAdditionalCameraIcon(id?: string | null) {
  return id && Object.hasOwn(ADDITIONAL_CAMERA_ICONS, id)
    ? ADDITIONAL_CAMERA_ICONS[id as AdditionalCameraIconId] : AdditionalCameraIcon;
}
// eslint-disable-next-line react-refresh/only-export-components
export function resolveBothCameraIcon(id?: string | null) {
  return id && Object.hasOwn(BOTH_CAMERA_ICONS, id)
    ? BOTH_CAMERA_ICONS[id as BothCameraIconId] : BothCamerasIcon;
}

/** Translation metadata is separate from the persisted identifiers and artwork. */
export const CAMERA_ICON_LABEL_KEYS = {
  'camera-plus': 'additionalCameras.icons.cameraPlus',
  'video-plus': 'additionalCameras.icons.videoPlus',
  overhead: 'additionalCameras.icons.overhead',
  chamber: 'additionalCameras.icons.chamber',
  webcam: 'additionalCameras.icons.webcam',
  'security-camera': 'additionalCameras.icons.securityCamera',
  'board-camera': 'additionalCameras.icons.boardCamera',
  'dual-camera': 'additionalCameras.icons.dualCamera',
  'overlapping-cameras': 'additionalCameras.icons.overlappingCameras',
  'side-by-side': 'additionalCameras.icons.sideBySide',
  'split-camera-view': 'additionalCameras.icons.splitCameraView',
} as const;
