import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoomLog } from '@plume/model';

function isRoomLog(value: unknown): value is RoomLog {
  if (!value || typeof value !== 'object') return false;
  const room = value as RoomLog;
  return (
    typeof room.version === 'number' &&
    typeof room.base === 'number' &&
    Array.isArray(room.steps) &&
    !!room.doc &&
    typeof room.doc === 'object' &&
    Array.isArray(room.doc.objects)
  );
}

export async function loadRooms(dir: string): Promise<Map<string, RoomLog>> {
  const rooms = new Map<string, RoomLog>();
  let names: string[];
  try {
    names = await readdir(join(dir, 'rooms'));
  } catch {
    return rooms;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, 'rooms', name), 'utf8'));
      if (!isRoomLog(parsed)) continue;
      rooms.set(decodeURIComponent(name.slice(0, -'.json'.length)), parsed);
    } catch {
      continue;
    }
  }
  return rooms;
}

export async function saveRoom(dir: string, boardId: string, room: RoomLog): Promise<void> {
  const body = JSON.stringify(room);
  const roomsDir = join(dir, 'rooms');
  await mkdir(roomsDir, { recursive: true });
  const target = join(roomsDir, `${encodeURIComponent(boardId)}.json`);
  const temp = join(
    roomsDir,
    `.${encodeURIComponent(boardId)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temp, body);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
