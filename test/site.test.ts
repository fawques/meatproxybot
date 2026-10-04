import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import { USAGE_RETENTION_DAYS } from "../src/usage.js";

/**
 * Test that the privacy policy lists match the actual audit fields and
 * installation fields captured at runtime.
 */
describe("site field sync", () => {
  it("audit fields in policy match actual audit log fields", async () => {
    const privacyHtml = await fs.readFile(
      path.join(process.cwd(), "site", "privacy", "index.html"),
      "utf-8",
    );

    // Extract the audit fields from the policy
    const auditMatch = privacyHtml.match(
      /<ul data-fields="audit">([\s\S]*?)<\/ul>/,
    );
    expect(auditMatch).toBeTruthy();
    const auditSection = auditMatch?.[1];
    expect(auditSection).toBeDefined();

    const auditFieldsInPolicy = Array.from(
      (auditSection ?? "").matchAll(/<code>([^<]+)<\/code>/g),
    ).map((m) => m[1]);

    // Expected audit fields from src/callOut.ts
    // When status is "error", reason is included; otherwise it is not.
    // The policy lists it as conditional, but the test checks that the
    // policy mentions both status and reason.
    const expectedAuditFields = [
      "event",
      "trigger",
      "invoker",
      "channel",
      "ts",
      "poster",
      "status",
      "reason",
    ];

    expect(auditFieldsInPolicy.sort()).toEqual(expectedAuditFields.sort());
  });

  it("installation fields in policy match actual stored fields", async () => {
    const privacyHtml = await fs.readFile(
      path.join(process.cwd(), "site", "privacy", "index.html"),
      "utf-8",
    );

    // Extract the installation fields from the policy
    const installMatch = privacyHtml.match(
      /<ul data-fields="installation">([\s\S]*?)<\/ul>/,
    );
    expect(installMatch).toBeTruthy();
    const installSection = installMatch?.[1];
    expect(installSection).toBeDefined();

    const installFieldsInPolicy = Array.from(
      (installSection ?? "").matchAll(/<code>([^<]+)<\/code>/g),
    ).map((m) => m[1]);

    // Expected installation fields from src/installationStore.ts
    const expectedInstallFields = [
      "team.id",
      "enterprise.id",
      "bot.id",
      "bot.token",
      "bot_user_id",
      "app_id",
      "created_at",
      "updated_at",
    ];

    expect(installFieldsInPolicy.sort()).toEqual(expectedInstallFields.sort());
  });

  it("workspace settings fields in policy match the stored columns", async () => {
    const privacyHtml = await fs.readFile(
      path.join(process.cwd(), "site", "privacy", "index.html"),
      "utf-8",
    );

    const settingsSection = privacyHtml.match(
      /<ul data-fields="workspace_settings">([\s\S]*?)<\/ul>/,
    )?.[1];
    expect(settingsSection).toBeDefined();

    const settingsFieldsInPolicy = Array.from(
      (settingsSection ?? "").matchAll(/<code>([^<]+)<\/code>/g),
    ).map((m) => m[1]);

    // Expected columns of workspace_settings in src/workspaceStore.ts
    const workspaceStore = await fs.readFile(
      path.join(process.cwd(), "src", "workspaceStore.ts"),
      "utf-8",
    );
    const columns = Array.from(
      (
        workspaceStore.match(
          /CREATE TABLE IF NOT EXISTS [^(]*\(([\s\S]*?)\);/,
        )?.[1] ?? ""
      ).matchAll(/^\s*([a-z_]+) /gm),
    ).map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(0);

    expect(settingsFieldsInPolicy.sort()).toEqual(columns.sort());
  });

  it("usage fields in policy match the usage_events columns", async () => {
    const privacyHtml = await fs.readFile(
      path.join(process.cwd(), "site", "privacy", "index.html"),
      "utf-8",
    );

    const usageMatch = privacyHtml.match(
      /<ul data-fields="usage">([\s\S]*?)<\/ul>/,
    );
    expect(usageMatch).toBeTruthy();

    const usageFieldsInPolicy = Array.from(
      (usageMatch?.[1] ?? "").matchAll(/<code>([^<]+)<\/code>/g),
    ).map((m) => m[1]);

    // Expected columns from src/usage.ts (besides the row id)
    const expectedUsageFields = [
      "team_id",
      "trigger",
      "status",
      "invoker_hash",
      "created_at",
    ];

    expect(usageFieldsInPolicy.sort()).toEqual(expectedUsageFields.sort());
    expect(privacyHtml.replace(/\s+/g, " ")).toContain(
      `Usage records are deleted ${String(USAGE_RETENTION_DAYS)} days after the callout`,
    );
  });
});

/**
 * Test that placeholders and navigation are consistent across all site pages.
 */
describe("site consistency", () => {
  it("all pages use the same placeholders", async () => {
    const pages = ["index.html", "privacy/index.html", "support/index.html"];
    const siteDir = path.join(process.cwd(), "site");

    const placeholders = new Map<string, Set<string>>();
    const allPlaceholders = new Set<string>([
      "BOT_BASE_URL",
      "SUPPORT_EMAIL",
      "CONTROLLER_COUNTRY",
    ]);

    for (const page of pages) {
      const html = await fs.readFile(path.join(siteDir, page), "utf-8");
      const found = new Set<string>();

      for (const placeholder of allPlaceholders) {
        if (html.includes(placeholder)) {
          found.add(placeholder);
        }
      }

      placeholders.set(page, found);
    }

    // The landing page must have BOT_BASE_URL for the Add to Slack button
    expect(placeholders.get("index.html")).toContain("BOT_BASE_URL");
    // Privacy and support pages must have SUPPORT_EMAIL
    expect(placeholders.get("privacy/index.html")).toContain("SUPPORT_EMAIL");
    expect(placeholders.get("support/index.html")).toContain("SUPPORT_EMAIL");
    // Privacy policy must have CONTROLLER_COUNTRY
    expect(placeholders.get("privacy/index.html")).toContain(
      "CONTROLLER_COUNTRY",
    );
  });

  it("Add to Slack link points to BOT_BASE_URL/slack/install", async () => {
    const html = await fs.readFile(
      path.join(process.cwd(), "site", "index.html"),
      "utf-8",
    );

    const linkMatch = html.match(
      /<a[^>]*href="([^"]*slack\/install[^"]*)"[^>]*class="button"/,
    );
    expect(linkMatch).toBeTruthy();
    expect(linkMatch?.[1]).toBe("BOT_BASE_URL/slack/install");
  });

  it("all pages have working navigation links", async () => {
    const pages = [
      { path: "index.html", name: "Home" },
      { path: "privacy/index.html", name: "Privacy" },
      { path: "support/index.html", name: "Support" },
    ];
    const siteDir = path.join(process.cwd(), "site");

    for (const page of pages) {
      const html = await fs.readFile(path.join(siteDir, page.path), "utf-8");

      // Check for nav links to all three pages
      expect(html).toContain('href="/"'); // Home
      expect(html).toContain('href="/privacy/"'); // Privacy
      expect(html).toContain('href="/support/"'); // Support
    }
  });
});
