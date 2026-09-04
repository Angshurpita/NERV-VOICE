import { bootstrap, createApp } from "./app.js";
import { config, describeConfig } from "./config.js";
import { agentWorker } from "./agent-worker.js";

/**
 * Persistent server and Agent Worker entry point.
 *
 * This process hosts both the stateless HTTP API and the stateful, persistent
 * Agora Agent Worker.
 */

const app = createApp();

await bootstrap();

for (const line of describeConfig()) {
  console.log(`  ${line}`);
}

const server = app.listen(config.PORT, () => {
  console.log(`\n  EchoSphere API          http://localhost:${config.PORT}`);
  console.log(
    `  EchoSphere Health       http://localhost:${config.PORT}/health`,
  );
  console.log(`  Agora Agent Worker      Active (stateful sessions enabled)\n`);
});

const shutdown = async (signal: string) => {
  console.log(
    `\n[server] Received ${signal} — shutting down persistent worker...`,
  );
  await agentWorker.shutdownAll();
  server.close(() => {
    console.log("[server] HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
