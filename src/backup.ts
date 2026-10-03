import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface BackupConfig {
  dbPath: string;
  backupDir: string;
  maxBackups: number;
}

export class BackupManager {
  private config: BackupConfig;
  private logger: (
    level: string,
    msg: string,
    fields?: Record<string, unknown>,
  ) => void;

  constructor(
    config: BackupConfig,
    logger: (
      level: string,
      msg: string,
      fields?: Record<string, unknown>,
    ) => void,
  ) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Performs a backup of the SQLite database to a dated file in the backup directory.
   * Prunes old backups, keeping only the most recent maxBackups files.
   * Logs errors but never throws, so backup failures don't crash the bot.
   */
  async backup(): Promise<void> {
    try {
      await this.ensureBackupDir();
      await this.createBackupFile();
      await this.pruneOldBackups();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.safeLog("error", "backup failed", {
        error,
        dbPath: this.config.dbPath,
      });
    }
  }

  private safeLog(
    level: string,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    try {
      this.logger(level, msg, fields);
    } catch {
      // Ignore logger errors
    }
  }

  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.backupDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `Failed to create backup directory: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  private async createBackupFile(): Promise<void> {
    const filename = this.getBackupFilename();
    const backupPath = path.join(this.config.backupDir, filename);

    try {
      await fs.copyFile(this.config.dbPath, backupPath);
      this.safeLog("info", "backup created", { filename });
    } catch (err) {
      throw new Error(
        `Failed to create backup file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  private getBackupFilename(): string {
    const date = new Date();
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `installations-${year}-${month}-${day}.sqlite`;
  }

  private async pruneOldBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.backupDir);
      const backupFiles = files
        .filter((f) => f.startsWith("installations-") && f.endsWith(".sqlite"))
        .sort()
        .reverse();

      if (backupFiles.length > this.config.maxBackups) {
        const filesToDelete = backupFiles.slice(this.config.maxBackups);
        for (const file of filesToDelete) {
          const filePath = path.join(this.config.backupDir, file);
          await fs.unlink(filePath);
          this.safeLog("info", "pruned old backup", { filename: file });
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to prune old backups: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

/**
 * Schedules a nightly backup at a fixed time each day (UTC midnight).
 * Backs up the SQLite database and prunes old backups.
 * Returns a cleanup function to stop the scheduled backup.
 */
export function scheduleNightlyBackup(
  config: BackupConfig,
  logger: (
    level: string,
    msg: string,
    fields?: Record<string, unknown>,
  ) => void,
): () => void {
  const backup = new BackupManager(config, logger);
  let timeoutId: NodeJS.Timeout | null = null;

  const scheduleNextBackup = (): void => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCHours(24, 0, 0, 0);
    const delay = nextMidnight.getTime() - now.getTime();

    logger("info", "backup scheduled", { delayMs: delay });

    timeoutId = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        await backup.backup();
        scheduleNextBackup();
      })();
    }, delay);
  };

  scheduleNextBackup();

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      logger("info", "backup scheduler stopped");
    }
  };
}
