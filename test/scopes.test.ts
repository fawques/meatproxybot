import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_SCOPES } from "../src/scopes.js";

const docsMarketplacePath = new URL("../docs/marketplace.md", import.meta.url)
  .pathname;

const srcDir = new URL("../src", import.meta.url);
const srcPath = srcDir.pathname;

function getSourceFiles(): string[] {
  return readdirSync(srcPath)
    .filter((f) => f.endsWith(".ts") && f !== "scopes.ts")
    .map((f) => join(srcPath, f));
}

function readAllSourceCode(): string {
  const files = getSourceFiles();
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("scopes.ts", () => {
  it("maps each scope to at least one method, event, or feature", () => {
    for (const [scope, mapping] of Object.entries(BOT_SCOPES)) {
      const hasContent =
        mapping.methods.length > 0 ||
        mapping.events.length > 0 ||
        mapping.features.length > 0;
      expect(
        hasContent,
        `Scope ${scope} has no methods, events, or features`,
      ).toBe(true);
    }
  });

  it("has every listed method called in src/ (ignoring scopes.ts)", () => {
    const sourceCode = readAllSourceCode();

    for (const [scope, mapping] of Object.entries(BOT_SCOPES)) {
      for (const method of mapping.methods) {
        const parts = method.split(".");
        const ns = parts[0];
        const methodName = parts[1];
        if (!ns || !methodName) continue;
        // Allow for whitespace or line breaks around the dot, since
        // client.reactions and .remove( can be on separate lines.
        const pattern = new RegExp(
          `client\\.${ns}[\\s\\S]*?\\.${methodName}\\s*\\(`,
          "g",
        );
        const found = pattern.test(sourceCode);
        expect(
          found,
          `Method ${method} (scope ${scope}) is not called in src/`,
        ).toBe(true);
      }
    }
  });

  it("has every client.<ns>.<method>( call in src/ listed in BOT_SCOPES", () => {
    const sourceCode = readAllSourceCode();

    // Match all client.<namespace>.<method>( patterns
    const callPattern = /client\.(\w+)[\s\S]*?\.(\w+)\s*\(/g;
    const calls = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(sourceCode)) !== null) {
      const ns = match[1];
      const method = match[2];
      if (ns && method) {
        calls.add(`${ns}.${method}`);
      }
    }

    // Collect all documented methods from BOT_SCOPES
    const documentedMethods = new Set<string>();
    for (const mapping of Object.values(BOT_SCOPES)) {
      for (const method of mapping.methods) {
        documentedMethods.add(method);
      }
    }

    for (const call of calls) {
      const message = `Method ${call} is called in src/ but not listed in BOT_SCOPES`;
      expect(documentedMethods.has(call), message).toBe(true);
    }
  });

  it("has every scope documented in docs/marketplace.md", () => {
    const docContent = readFileSync(docsMarketplacePath, "utf8");
    for (const scope of Object.keys(BOT_SCOPES)) {
      const escapedScope = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingPattern = new RegExp(`### \`${escapedScope}\``);
      const message = `Scope ${scope} not documented in docs/marketplace.md`;
      expect(headingPattern.test(docContent), message).toBe(true);
    }
  });
});
