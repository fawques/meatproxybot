#!/usr/bin/env node
// Slack CLI get-manifest hook: @slack/cli-hooks only reads manifest.json,
// so serve manifest.yml as JSON instead. Honors the message-boundaries protocol.
// Set SLACK_DEV_BASE_URL (env or .env) to swap the placeholder request URLs
// for a local tunnel, e.g. https://xyz.trycloudflare.com.
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

if (existsSync(".env")) process.loadEnvFile(".env");
const placeholder = "https://meatproxybot.example.com";
const baseUrl = process.env.SLACK_DEV_BASE_URL?.replace(/\/$/, "");

let text = readFileSync("manifest.yml", "utf8");
if (baseUrl) text = text.replaceAll(placeholder, baseUrl);

const boundaryArg = process.argv.find((a) => a.startsWith("--boundary="));
const boundary = boundaryArg ? boundaryArg.slice("--boundary=".length) : "";
console.log(boundary + JSON.stringify(parse(text)) + boundary);
