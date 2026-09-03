import { bootstrap, createApp } from './app.js';
import { config } from './config.js';

/**
 * Local development entry point.
 *
 * Vercel uses `api/index.ts` instead, which exports the same app without
 * listening on a port.
 */

const app = createApp();

await bootstrap();

app.listen(config.PORT, () => {
  console.log(`\n  Nerv API   http://localhost:${config.PORT}`);
  console.log(`  health           http://localhost:${config.PORT}/health\n`);
});
