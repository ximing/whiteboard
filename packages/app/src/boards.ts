import { createId } from '@plume/model';
import { deleteBoardStorage } from './storage';

export type BoardMeta = { id: string; title: string; updated: number };

const INDEX_KEY = 'plume.boards.v1';

function readIndex(): BoardMeta[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is BoardMeta => !!item && typeof item.id === 'string' && typeof item.title === 'string');
  } catch {
    return null;
  }
}

function writeIndex(boards: BoardMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(boards));
}

export function listBoards(): BoardMeta[] {
  const saved = readIndex();
  if (saved && saved.length) return saved;
  const home: BoardMeta = { id: 'home', title: 'Board', updated: Date.now() };
  if (typeof localStorage !== 'undefined') writeIndex([home]);
  return [home];
}

export function createBoard(title?: string): BoardMeta {
  const boards = listBoards();
  const board: BoardMeta = { id: createId(), title: title?.trim() || `Board ${boards.length + 1}`, updated: Date.now() };
  writeIndex([board, ...boards]);
  return board;
}

export function renameBoard(id: string, title: string): BoardMeta[] {
  const boards = listBoards().map((board) => (board.id === id ? { ...board, title: title.trim() || board.title, updated: Date.now() } : board));
  writeIndex(boards);
  return boards;
}

export function removeBoard(id: string): BoardMeta[] {
  const boards = listBoards().filter((board) => board.id !== id);
  const next = boards.length ? boards : [{ id: 'home', title: 'Board', updated: Date.now() }];
  writeIndex(next);
  void deleteBoardStorage(id);
  return next;
}
