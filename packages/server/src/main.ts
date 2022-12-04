import { createPlumeServer } from './listen.ts';

const port = Number(process.env.PLUME_PORT ?? 8790);
const dataDir = process.env.PLUME_DATA;
const server = await createPlumeServer({
  port,
  host: '0.0.0.0',
  ...(dataDir ? { dataDir } : {}),
});
console.log(`Plume authority ${server.url}`);
if (dataDir) console.log(`Persisting rooms in ${dataDir}`);
console.log('Connections are anonymous until you pass authorize().');
