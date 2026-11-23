// Erzeugt die PWA-Icons als PNG ohne Zusatzpakete: `node scripts/make-icons.mjs`
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [28, 26, 21]; // Tinte
const FG = [242, 204, 46]; // Markergelb

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Anteil des Pixels, der innerhalb der Form liegt (4x4-Supersampling für glatte Kanten). */
function coverage(x, y, inside) {
  let hits = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hits++;
  return hits / 16;
}

function icon(size) {
  const c = size / 2;
  const outer = size * 0.3;
  const inner = size * 0.2;
  const dot = size * 0.075;
  // Ring mit Lücke oben rechts und einem Punkt: „Wiederholung“.
  const shape = (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const r = Math.hypot(dx, dy);
    const angle = Math.atan2(-dy, dx);
    const inGap = angle > 0.15 && angle < 1.2;
    if (r <= outer && r >= inner && !inGap) return true;
    const mid = (outer + inner) / 2;
    return Math.hypot(x - (c + mid * Math.cos(0.68)), y - (c - mid * Math.sin(0.68))) <= dot;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, shape);
      for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = Math.round(BG[k] + (FG[k] - BG[k]) * a);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192));
writeFileSync("public/icons/icon-512.png", icon(512));
writeFileSync("src/app/apple-icon.png", icon(180));
writeFileSync("src/app/icon.png", icon(64));
console.log("Icons geschrieben.");
