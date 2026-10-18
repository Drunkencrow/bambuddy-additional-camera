import { useAuxiliaryCameraViewers } from '../../hooks/useAuxiliaryCameraViewers';

/** Test actions for exercising the page-owned viewer lifecycle in isolation. */
export function AuxiliaryCameraHarness() {
  const { open, viewers } = useAuxiliaryCameraViewers();
  return <>
    <button onClick={() => open('additional', 1)}>Test open additional</button>
    <button onClick={() => open('both', 1)}>Test open both</button>
    {viewers}
  </>;
}
