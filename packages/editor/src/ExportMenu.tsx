import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { Tip } from './Tip';

export function ExportMenu({
  gridDefault,
  selectionCount,
  onPng,
  onSvg,
  onSelection,
}: {
  gridDefault: boolean;
  selectionCount: number;
  onPng: (showGrid: boolean) => void;
  onSvg: () => void;
  onSelection: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [grid, setGrid] = useState(gridDefault);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="export-menu" ref={rootRef}>
      <Tip label={t('export.open')}>
        <button
          type="button"
          className="tool"
          aria-label={t('export.open')}
          aria-expanded={open}
          aria-pressed={open}
          onClick={() => {
            setOpen((value) => {
              if (!value) setGrid(gridDefault);
              return !value;
            });
          }}
        >
          <Icon name="export" />
        </button>
      </Tip>
      {open && (
        <div
          className="export-panel"
          role="dialog"
          aria-label={t('export.title')}
          data-testid="export-panel"
          onMouseDown={(event) => event.preventDefault()}
        >
          <h2>{t('export.title')}</h2>
          <button type="button" onClick={() => onPng(grid)}>
            {t('export.png')}
            <span>{t('export.pngHint')}</span>
          </button>
          <button type="button" onClick={onSvg}>
            {t('export.svg')}
            <span>{t('export.svgHint')}</span>
          </button>
          <button type="button" disabled={selectionCount === 0} title={selectionCount === 0 ? t('export.selectionEmpty') : undefined} onClick={onSelection}>
            {t('export.selection')}
            <span>{t('export.selectionHint')}</span>
          </button>
          <label className="export-grid">
            <input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} />
            {t('export.grid')}
          </label>
        </div>
      )}
    </div>
  );
}
