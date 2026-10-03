import {
  createApp,
  getGlobalInstallationStore,
  startBackupScheduler,
  getBackupCleanup,
} from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

function log(
  level: string,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log("error", err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  let app;
  try {
    app = await createApp(config);
  } catch (err) {
    log("error", "failed to create app", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
    return;
  }

  await app.start();

  startBackupScheduler(config, log);

  log("info", "meatproxybot ready", {
    port: config.port,
    triggerEmoji: config.triggerEmoji,
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log("info", "meatproxybot shutting down", { signal });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      try {
        const backupCleanup = getBackupCleanup();
        if (backupCleanup) {
          backupCleanup();
        }
        await app.stop();
        const store = getGlobalInstallationStore();
        if (store) {
          await store.close();
        }
        log("info", "meatproxybot stopped");
        process.exit(0);
      } catch (err) {
        log("error", "error while stopping", { error: String(err) });
        process.exit(1);
      }
    })();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  log("error", "fatal error", {
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
