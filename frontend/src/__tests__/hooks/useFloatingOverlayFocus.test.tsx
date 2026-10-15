import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFloatingOverlayFocus } from '../../hooks/useFloatingOverlayFocus';

function Overlay({ identity }: { identity: string }) {
  const { zIndex, ...handlers } = useFloatingOverlayFocus(identity);
  return (
    <button {...handlers} style={{ zIndex }}>
      {identity}
    </button>
  );
}

describe('shared floating overlay focus', () => {
  it('supports arbitrary identities and multiple printers with bounded ownership and restores the prior owner on close', () => {
    const view = render(
      <>
        <Overlay key="primary:1" identity="primary:1" />
        <Overlay key="additional:2" identity="additional:2" />
        <Overlay key="future-viewer:3" identity="future-viewer:3" />
      </>,
    );
    const primary = screen.getByText('primary:1');
    const additional = screen.getByText('additional:2');
    const future = screen.getByText('future-viewer:3');
    expect(future.style.zIndex).toBe('41');
    for (let i = 0; i < 100; i++) {
      fireEvent.click(primary);
      expect(primary.style.zIndex).toBe('41');
      expect(additional.style.zIndex).toBe('40');
      expect(future.style.zIndex).toBe('40');
      fireEvent.click(additional);
      expect(additional.style.zIndex).toBe('41');
      expect(primary.style.zIndex).toBe('40');
    }
    view.rerender(
      <>
        <Overlay key="primary:1" identity="primary:1" />
        <Overlay key="future-viewer:3" identity="future-viewer:3" />
      </>,
    );
    expect(primary.style.zIndex).toBe('41');
    view.unmount();
    render(<Overlay key="new-session:4" identity="new-session:4" />);
    expect(screen.getByText('new-session:4').style.zIndex).toBe('41');
  });
});
