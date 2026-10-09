import { createLocalProvider, createServerProvider } from '@plume/collab';
import { PlumeEditor, useTranslation } from '@plume/editor';
import { useMemo, useState } from 'react';
import { createBoard, listBoards, removeBoard, renameBoard, type BoardMeta } from './boards';
import { browserStorageFor } from './storage';

function demoName(): string {
  const existing = sessionStorage.getItem('plume.name');
  if (existing) return existing;
  const next = `Guest ${Math.floor(Math.random() * 90 + 10)}`;
  sessionStorage.setItem('plume.name', next);
  return next;
}

export function Demo() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<BoardMeta[]>(() => listBoards());
  const [active, setActive] = useState(() => listBoards()[0].id);
  const [open, setOpen] = useState(false);
  const [authority, setAuthority] = useState<'local' | 'server'>('local');
  const [readOnly, setReadOnly] = useState(false);
  const [userName] = useState(demoName);
  const storage = useMemo(() => browserStorageFor(active), [active]);
  const collab = useMemo(
    () => (authority === 'server' ? createServerProvider({ url: 'ws://127.0.0.1:8790', boardId: active }) : createLocalProvider(active)),
    [active, authority],
  );
  const current = boards.find((board) => board.id === active) ?? boards[0];

  return (
    <>
      <PlumeEditor key={`${active}:${authority}`} collab={collab} storage={storage} userName={userName} readOnly={readOnly} />
      <div className="boards">
        <div className="boards-switch">
          <button type="button" className="boards-current" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {current?.title ?? t('demo.fallback')}
          </button>
          {open && (
            <div className="boards-menu" role="menu">
              {boards.map((board) => (
                <div key={board.id} className="boards-row">
                  <button
                    type="button"
                    className="boards-name"
                    aria-current={board.id === active}
                    onClick={() => {
                      setActive(board.id);
                      setOpen(false);
                    }}
                  >
                    {board.title}
                  </button>
                  <input
                    aria-label={t('demo.rename', { title: board.title })}
                    defaultValue={board.title}
                    onBlur={(event) => setBoards(renameBoard(board.id, event.target.value))}
                  />
                </div>
              ))}
              <div className="boards-actions">
                <button
                  type="button"
                  onClick={() => {
                    const board = createBoard(t('demo.boardName', { n: boards.length + 1 }));
                    setBoards(listBoards());
                    setActive(board.id);
                    setOpen(false);
                  }}
                >
                  {t('demo.newBoard')}
                </button>
                {boards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = removeBoard(active);
                      setBoards(next);
                      setActive(next[0].id);
                      setOpen(false);
                    }}
                  >
                    {t('demo.delete')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="boards-current"
          aria-pressed={authority === 'server'}
          onClick={() => setAuthority((value) => (value === 'local' ? 'server' : 'local'))}
        >
          {authority === 'server' ? t('demo.server') : t('demo.local')}
        </button>
        <button
          type="button"
          className="boards-current"
          aria-pressed={readOnly}
          onClick={() => setReadOnly((value) => !value)}
        >
          {readOnly ? t('demo.viewing') : t('demo.editing')}
        </button>
      </div>
    </>
  );
}
