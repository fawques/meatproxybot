import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BackupManager } from "../src/backup.js";

describe("BackupManager", () => {
  const tempDir = `/tmp/meatproxybot-backup-test-${String(Date.now())}`;
  let dbPath: string;
  let backupDir: string;
  let loggedMessages: Array<{
    level: string;
    msg: string;
    fields: Record<string, unknown> | undefined;
  }> = [];

  const mockLogger = (
    level: string,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    loggedMessages.push({ level, msg, fields });
  };

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    dbPath = path.join(tempDir, "test.sqlite");
    backupDir = path.join(tempDir, "backups");
    loggedMessages = [];

    // Create a fake database file
    await fs.writeFile(dbPath, "fake database content");
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("backup", () => {
    it("creates a backup file with correct naming format", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 7,
        },
        mockLogger,
      );

      await manager.backup();

      const files = await fs.readdir(backupDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^installations-\d{4}-\d{2}-\d{2}\.sqlite$/);
    });

    it("copies database file content to backup", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 7,
        },
        mockLogger,
      );

      await manager.backup();

      const files = await fs.readdir(backupDir);
      expect(files.length).toBeGreaterThan(0);
      const backupPath = path.join(backupDir, files[0] ?? "");
      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(backupContent).toBe("fake database content");
    });

    it("logs backup creation", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 7,
        },
        mockLogger,
      );

      await manager.backup();

      const createdMsg = loggedMessages.find((m) => m.msg === "backup created");
      expect(createdMsg).toBeDefined();
      expect(createdMsg?.level).toBe("info");
      expect(createdMsg?.fields?.filename).toMatch(
        /^installations-\d{4}-\d{2}-\d{2}\.sqlite$/,
      );
    });
  });

  describe("backup pruning", () => {
    it("keeps only the most recent maxBackups files", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 3,
        },
        mockLogger,
      );

      // Create 5 backups
      for (let i = 0; i < 5; i++) {
        const filename = `installations-2026-01-${String(i + 1).padStart(2, "0")}.sqlite`;
        const filePath = path.join(backupDir, filename);
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(filePath, `backup ${String(i)}`);
      }

      await manager.backup();

      const files = await fs.readdir(backupDir);
      expect(files.length).toBeLessThanOrEqual(3);
    });

    it("deletes oldest backups when exceeding limit", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 2,
        },
        mockLogger,
      );

      // Create 3 backups with specific dates
      const oldFile = path.join(backupDir, "installations-2026-01-01.sqlite");
      const middleFile = path.join(
        backupDir,
        "installations-2026-01-02.sqlite",
      );
      const newFile = path.join(backupDir, "installations-2026-01-03.sqlite");

      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(oldFile, "old");
      await fs.writeFile(middleFile, "middle");
      await fs.writeFile(newFile, "new");

      loggedMessages = [];
      await manager.backup();

      const files = await fs.readdir(backupDir);
      expect(files.length).toBe(2);
      expect(files).not.toContain("installations-2026-01-01.sqlite");

      // Verify deletion was logged
      const prunedMsgs = loggedMessages.filter(
        (m) => m.msg === "pruned old backup",
      );
      expect(prunedMsgs.length).toBeGreaterThan(0);
    });

    it("logs pruned files", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir,
          maxBackups: 2,
        },
        mockLogger,
      );

      // Create 3 old backups
      const file1 = path.join(backupDir, "installations-2026-01-01.sqlite");
      const file2 = path.join(backupDir, "installations-2026-01-02.sqlite");
      const file3 = path.join(backupDir, "installations-2026-01-03.sqlite");
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(file1, "old1");
      await fs.writeFile(file2, "old2");
      await fs.writeFile(file3, "current");

      loggedMessages = [];
      // Call backup which should prune down to 2 files (maxBackups)
      // and log the pruned file
      await manager.backup();

      const prunedMsgs = loggedMessages.filter(
        (m) => m.msg === "pruned old backup",
      );
      expect(prunedMsgs.length).toBeGreaterThan(0);
      // Should prune at least one file
      const prunedFilenames = prunedMsgs.map((m) => m.fields?.filename);
      expect(prunedFilenames).toContain("installations-2026-01-01.sqlite");
    });
  });

  describe("error handling", () => {
    it("logs errors without throwing when backup directory creation fails", async () => {
      const manager = new BackupManager(
        {
          dbPath,
          backupDir: "/root/invalid/path/that/cannot/be/created",
          maxBackups: 7,
        },
        mockLogger,
      );

      // Should not throw
      await expect(manager.backup()).resolves.not.toThrow();

      const errorMsg = loggedMessages.find((m) => m.level === "error");
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.msg).toBe("backup failed");
    });

    it("logs errors when backup file cannot be copied", async () => {
      const manager = new BackupManager(
        {
          dbPath: "/nonexistent/database.sqlite",
          backupDir,
          maxBackups: 7,
        },
        mockLogger,
      );

      // Should not throw
      await expect(manager.backup()).resolves.not.toThrow();

      const errorMsg = loggedMessages.find((m) => m.level === "error");
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.msg).toBe("backup failed");
    });

    it("never crashes on backup failures", async () => {
      // Logger that throws - should not crash the backup
      let callCount = 0;
      const badLogger = (): void => {
        callCount++;
        throw new Error("Logger threw");
      };

      const manager = new BackupManager(
        {
          dbPath: "/nonexistent/db",
          backupDir,
          maxBackups: 7,
        },
        badLogger,
      );

      // Should not throw even if logger throws
      await expect(manager.backup()).resolves.not.toThrow();
      expect(callCount).toBeGreaterThan(0);
    });
  });
});
