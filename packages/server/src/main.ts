import { createPlumeServer } from './listen.ts';

const port = Number(process.env.PLUME_PORT ?? 8790);
const server = await createPlumeServer({ port, host: '0.0.0.0' });
console.log(`Plume authority ${server.url}`);
console.log('Connections are anonymous until you pass authorize().');
