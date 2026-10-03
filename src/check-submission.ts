#!/usr/bin/env node

import { promises as fs } from "fs";
import * as path from "path";

/**
 * Pre-submission check: ensures all required placeholders have been replaced.
 * This script fails if any placeholder is found in the site/ directory.
 *
 * Usage: npm run check:submission
 *
 * Before submitting to the Slack Marketplace, run the sed command from docs/marketplace.md.
 */

async function checkSubmission(): Promise<void> {
  const placeholders = ["BOT_BASE_URL", "SUPPORT_EMAIL", "CONTROLLER_COUNTRY"];
  const siteDir = path.join(process.cwd(), "site");

  const files = [
    "index.html",
    "privacy/index.html",
    "support/index.html",
    "styles.css",
  ];

  const issues: string[] = [];

  for (const file of files) {
    const filePath = path.join(siteDir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");

      for (const placeholder of placeholders) {
        if (content.includes(placeholder)) {
          issues.push(`${file}: contains placeholder "${placeholder}"`);
        }
      }
    } catch {
      // File doesn't exist, skip it
    }
  }

  if (issues.length > 0) {
    console.error("❌ Submission check failed:");
    issues.forEach((issue) => {
      console.error(`  - ${issue}`);
    });
    console.error("\nBefore submission, replace all placeholders using:");
    console.error(
      "  sed -i -e 's/BOT_BASE_URL/https:\\/\\/YOUR_DOMAIN\\/meatproxybot/g' \\",
    );
    console.error("      -e 's/SUPPORT_EMAIL/your-email@example.com/g' \\");
    console.error("      -e 's/CONTROLLER_COUNTRY/your-country/g' \\");
    console.error("      site/**/*.html\n");
    process.exit(1);
  }

  console.log("✓ Submission check passed: all placeholders have been replaced");
  process.exit(0);
}

checkSubmission().catch((err: unknown) => {
  console.error("Error running submission check:", err);
  process.exit(1);
});
