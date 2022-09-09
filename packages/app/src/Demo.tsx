import { createLocalProvider } from '@plume/collab';
import { PlumeEditor } from '@plume/editor';
import { useMemo } from 'react';
import { browserStorage } from './storage';

export function Demo() {
  const collab = useMemo(() => createLocalProvider(), []);
  return <PlumeEditor collab={collab} storage={browserStorage} />;
}
