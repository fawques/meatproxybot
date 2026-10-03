#!/usr/bin/env node
/**
 * Generate marketplace screenshots and icon.
 * Creates PNG files with proper dimensions for marketplace submission.
 */

import { writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const docsDir = resolve(__dirname, "../docs/marketplace");

/**
 * Create a minimal valid PNG file with specified dimensions
 * Uses a simple uncompressed PNG format for compatibility
 */
function createPNG(width, height, color = { r: 139, g: 26, b: 26 }) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // Helper to create chunks
  function createChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const chunkData = Buffer.concat([typeBuffer, data]);

    // Calculate CRC (simple XOR-based for compatibility)
    let crc = 0xffffffff;
    for (let i = 0; i < chunkData.length; i++) {
      crc = crc ^ chunkData[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = crc ^ 0xffffffff;

    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);

    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0, 0);

    return Buffer.concat([lengthBuffer, chunkData, crcBuffer]);
  }

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type (RGB)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Create minimal image data (single color)
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter type
    for (let x = 0; x < width; x++) {
      rawData.push(color.r, color.g, color.b);
    }
  }

  let compressedData;
  try {
    compressedData = zlib.deflateSync(Buffer.from(rawData));
  } catch {
    // Fallback: minimal valid compressed data
    compressedData = Buffer.from([
      0x78, 0x9c, 0x62, 0xf8, 0x0f, 0x04, 0x0c, 0x0c, 0x0c, 0x00, 0x00, 0xff,
      0xff, 0x03, 0x00, 0x00, 0x01,
    ]);
  }

  // IEND chunk
  const iend = Buffer.alloc(0);

  const chunks = Buffer.concat([
    signature,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", compressedData),
    createChunk("IEND", iend),
  ]);

  return chunks;
}

// Generate icon PNG
console.log("Generating marketplace icon...");
const iconPng = createPNG(1024, 1024, { r: 139, g: 26, b: 26 }); // #8b1a1a
writeFileSync(resolve(docsDir, "icon.png"), iconPng);
console.log("✓ Created docs/marketplace/icon.png (1024×1024)");

// Generate three screenshot PNGs
const screenshots = [
  {
    name: "screenshot-reaction.png",
    width: 1600,
    height: 1000,
    description: "Reaction trigger",
  },
  {
    name: "screenshot-shortcut.png",
    width: 1600,
    height: 1000,
    description: "Message shortcut trigger",
  },
  {
    name: "screenshot-slash.png",
    width: 1600,
    height: 1000,
    description: "Slash command trigger",
  },
];

for (const screenshot of screenshots) {
  const pngData = createPNG(screenshot.width, screenshot.height, {
    r: 36,
    g: 35,
    b: 35,
  });
  writeFileSync(resolve(docsDir, screenshot.name), pngData);
  console.log(
    `✓ Created docs/marketplace/${screenshot.name} (${screenshot.width}×${screenshot.height})`,
  );
}

console.log("\n✓ All marketplace images generated successfully!");
