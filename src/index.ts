import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

function log(
  level: "info" | "error",
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

  const app = createApp(config);
  await app.start();
  log("info", "meatproxybot ready", {
    port: config.port,
    triggerEmoji: config.triggerEmoji,
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log("info", "meatproxybot shutting down", { signal });
    app.stop().then(
      () => {
        log("info", "meatproxybot stopped");
        process.exit(0);
      },
      (err: unknown) => {
        log("error", "error while stopping", { error: String(err) });
        process.exit(1);
      },
    );
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
