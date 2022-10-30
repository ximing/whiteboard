import { Icon } from './icons';
import { Tip } from './Tip';

type Order = 'front' | 'back' | 'forward' | 'backward';
type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function SelectionBar({
  count,
  locked,
  grouped,
  onDuplicate,
  onOrder,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
  onLock,
}: {
  count: number;
  locked: boolean;
  grouped: boolean;
  onDuplicate: () => void;
  onOrder: (mode: Order) => void;
  onAlign: (mode: Align) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onLock: (locked: boolean) => void;
}) {
  if (count === 0) return null;
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selection"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('input, textarea')) return;
        event.preventDefault();
      }}
    >
      <Tip label="Duplicate">
        <button type="button" className="tool" aria-label="Duplicate" onClick={onDuplicate}>
          <Icon name="copy" />
        </button>
      </Tip>
      <Tip label="Forward">
        <button type="button" className="tool" aria-label="Bring forward" onClick={() => onOrder('forward')}>
          <Icon name="forward" />
        </button>
      </Tip>
      <Tip label="Backward">
        <button type="button" className="tool" aria-label="Send backward" onClick={() => onOrder('backward')}>
          <Icon name="backward" />
        </button>
      </Tip>
      <Tip label="To front">
        <button type="button" className="tool" aria-label="Bring to front" onClick={() => onOrder('front')}>
          <Icon name="front" />
        </button>
      </Tip>
      <Tip label="To back">
        <button type="button" className="tool" aria-label="Send to back" onClick={() => onOrder('back')}>
          <Icon name="back" />
        </button>
      </Tip>
      <Tip label={locked ? 'Unlock' : 'Lock'}>
        <button type="button" className="tool" aria-label={locked ? 'Unlock' : 'Lock'} aria-pressed={locked} onClick={() => onLock(!locked)}>
          <Icon name={locked ? 'unlock' : 'lock'} />
        </button>
      </Tip>
      {count >= 2 && (
        <Tip label={grouped ? 'Ungroup' : 'Group'}>
          <button type="button" className="tool" aria-label={grouped ? 'Ungroup' : 'Group'} onClick={grouped ? onUngroup : onGroup}>
            <Icon name={grouped ? 'ungroup' : 'group'} />
          </button>
        </Tip>
      )}
      {count >= 2 &&
        (
          [
            ['left', 'Align left', 'align-left'],
            ['center', 'Align center', 'align-center'],
            ['right', 'Align right', 'align-right'],
            ['top', 'Align top', 'align-top'],
            ['middle', 'Align middle', 'align-middle'],
            ['bottom', 'Align bottom', 'align-bottom'],
          ] as const
        ).map(([mode, label, icon]) => (
          <Tip key={mode} label={label}>
            <button type="button" className="tool" aria-label={label} onClick={() => onAlign(mode)}>
              <Icon name={icon} />
            </button>
          </Tip>
        ))}
      {count >= 3 && (
        <>
          <Tip label="Distribute horizontally">
            <button type="button" className="tool" aria-label="Distribute horizontally" onClick={() => onDistribute('horizontal')}>
              <Icon name="distribute-h" />
            </button>
          </Tip>
          <Tip label="Distribute vertically">
            <button type="button" className="tool" aria-label="Distribute vertically" onClick={() => onDistribute('vertical')}>
              <Icon name="distribute-v" />
            </button>
          </Tip>
        </>
      )}
    </div>
  );
}
