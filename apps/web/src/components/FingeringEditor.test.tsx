import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { KeyPosition, FingerLabel } from '@typsy/shared';
import { posKey } from '@typsy/shared';
import FingeringEditor from './FingeringEditor.tsx';

// Tiny 2-key fixture is enough to exercise the keymap. The real layouts
// have 30 alpha keys but the editor's row/col logic is content-agnostic.
const POSITIONS: KeyPosition[] = [
  { char: 'a', row: 1, col: 0, finger: 'left_pinky' },
  { char: 's', row: 1, col: 1, finger: 'left_ring' },
];

afterEach(() => {
  cleanup();
});

describe('FingeringEditor', () => {
  it('assigns the right_thumb finger when Digit6 is pressed with the picker open', () => {
    // Regression test for a stale-closure bug: the keymap-binding handlers
    // for digit keys were memoized on `[positions]`, so the `assignFinger`
    // they captured was the very first instance — created before the user
    // had selected any key. That stale closure always saw `selectedPos`
    // as null and returned early, so number shortcuts silently no-op'd
    // even though clicking the picker buttons (which always call the
    // *current* `assignFinger`) still worked. Routing the read through
    // `stateRef` fixes it.
    const onChange = vi.fn<[Record<string, FingerLabel>], void>();
    const { getByText } = render(
      <FingeringEditor positions={POSITIONS} onChange={onChange} />,
    );

    // Click the 'a' key to select it and open the finger picker.
    fireEvent.click(getByText('a'));

    // Digit6 → FINGER_LABELS[5] = 'right_thumb'.
    fireEvent.keyDown(document, { code: 'Digit6' });

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall![posKey({ row: 1, col: 0 })]).toBe('right_thumb');
  });

  it('still no-ops digit shortcuts when no key is selected', () => {
    const onChange = vi.fn<[Record<string, FingerLabel>], void>();
    render(<FingeringEditor positions={POSITIONS} onChange={onChange} />);

    onChange.mockClear(); // ignore the initial render's onChange call
    fireEvent.keyDown(document, { code: 'Digit1' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
