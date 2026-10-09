import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  if (count === 0) return null;
  const align: { mode: Align; label: string; icon: string }[] = [
    { mode: 'left', label: t('selection.alignLeft'), icon: 'align-left' },
    { mode: 'center', label: t('selection.alignCenter'), icon: 'align-center' },
    { mode: 'right', label: t('selection.alignRight'), icon: 'align-right' },
    { mode: 'top', label: t('selection.alignTop'), icon: 'align-top' },
    { mode: 'middle', label: t('selection.alignMiddle'), icon: 'align-middle' },
    { mode: 'bottom', label: t('selection.alignBottom'), icon: 'align-bottom' },
  ];
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label={t('selection.bar')}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('input, textarea')) return;
        event.preventDefault();
      }}
    >
      <Tip label={t('selection.duplicate')}>
        <button type="button" className="tool" aria-label={t('selection.duplicate')} onClick={onDuplicate}>
          <Icon name="copy" />
        </button>
      </Tip>
      <Tip label={t('selection.forward')}>
        <button type="button" className="tool" aria-label={t('selection.forward')} onClick={() => onOrder('forward')}>
          <Icon name="forward" />
        </button>
      </Tip>
      <Tip label={t('selection.backward')}>
        <button type="button" className="tool" aria-label={t('selection.backward')} onClick={() => onOrder('backward')}>
          <Icon name="backward" />
        </button>
      </Tip>
      <Tip label={t('selection.front')}>
        <button type="button" className="tool" aria-label={t('selection.front')} onClick={() => onOrder('front')}>
          <Icon name="front" />
        </button>
      </Tip>
      <Tip label={t('selection.back')}>
        <button type="button" className="tool" aria-label={t('selection.back')} onClick={() => onOrder('back')}>
          <Icon name="back" />
        </button>
      </Tip>
      <Tip label={locked ? t('selection.unlock') : t('selection.lock')}>
        <button type="button" className="tool" aria-label={locked ? t('selection.unlock') : t('selection.lock')} aria-pressed={locked} onClick={() => onLock(!locked)}>
          <Icon name={locked ? 'unlock' : 'lock'} />
        </button>
      </Tip>
      {count >= 2 && (
        <Tip label={grouped ? t('selection.ungroup') : t('selection.group')}>
          <button type="button" className="tool" aria-label={grouped ? t('selection.ungroup') : t('selection.group')} onClick={grouped ? onUngroup : onGroup}>
            <Icon name={grouped ? 'ungroup' : 'group'} />
          </button>
        </Tip>
      )}
      {count >= 2 &&
        align.map(({ mode, label, icon }) => (
          <Tip key={mode} label={label}>
            <button type="button" className="tool" aria-label={label} onClick={() => onAlign(mode)}>
              <Icon name={icon} />
            </button>
          </Tip>
        ))}
      {count >= 3 && (
        <>
          <Tip label={t('selection.distributeH')}>
            <button type="button" className="tool" aria-label={t('selection.distributeH')} onClick={() => onDistribute('horizontal')}>
              <Icon name="distribute-h" />
            </button>
          </Tip>
          <Tip label={t('selection.distributeV')}>
            <button type="button" className="tool" aria-label={t('selection.distributeV')} onClick={() => onDistribute('vertical')}>
              <Icon name="distribute-v" />
            </button>
          </Tip>
        </>
      )}
    </div>
  );
}
