import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const publicDirectory = resolve(import.meta.dir, "../public");
const publicPath = (name: string): string => resolve(publicDirectory, name);

const pngSizes = new Map<string, number>([
  ["favicon-16x16.png", 16],
  ["favicon-32x32.png", 32],
  ["favicon-48x48.png", 48],
  ["favicon-64x64.png", 64],
  ["favicon-128x128.png", 128],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-192.png", 192],
  ["icon-maskable-512.png", 512],
]);

async function assertOpaque(name: string): Promise<void> {
  const pixels = await sharp(publicPath(name)).ensureAlpha().raw().toBuffer();
  let minimumAlpha = 255;
  for (let index = 3; index < pixels.length; index += 4) {
    minimumAlpha = Math.min(minimumAlpha, pixels[index] ?? 0);
  }
  expect(minimumAlpha).toBe(255);
}

async function icoFrameSizes(bytes: Buffer): Promise<number[]> {
  expect(bytes.readUInt16LE(0)).toBe(0);
  expect(bytes.readUInt16LE(2)).toBe(1);
  const count = bytes.readUInt16LE(4);
  expect(count).toBe(4);
  const sizes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes.readUInt8(offset) || 256;
    const height = bytes.readUInt8(offset + 1) || 256;
    const planes = bytes.readUInt16LE(offset + 4);
    const bitDepth = bytes.readUInt16LE(offset + 6);
    const byteLength = bytes.readUInt32LE(offset + 8);
    const imageOffset = bytes.readUInt32LE(offset + 12);
    expect(width).toBe(height);
    expect(planes).toBe(1);
    expect(bitDepth).toBe(32);
    expect(byteLength).toBeGreaterThan(0);
    expect(imageOffset + byteLength).toBeLessThanOrEqual(bytes.length);
    const metadata = await sharp(
      bytes.subarray(imageOffset, imageOffset + byteLength),
    ).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(width);
    expect(metadata.height).toBe(height);
    sizes.push(width);
  }
  return sizes;
}

describe("favicon and installable icon suite", () => {
  test("ships correctly decoded PNG dimensions and opaque Apple/maskable canvases", async () => {
    for (const [name, size] of pngSizes) {
      const metadata = await sharp(publicPath(name)).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }
    await assertOpaque("apple-touch-icon.png");
    await assertOpaque("icon-maskable-192.png");
    await assertOpaque("icon-maskable-512.png");
  });

  test("contains a genuine multi-frame ICO and self-contained SVG sources", async () => {
    expect(
      (await icoFrameSizes(await readFile(publicPath("favicon.ico")))).sort(
        (left, right) => left - right,
      ),
    ).toEqual([16, 32, 48, 64]);
    for (const name of ["favicon.svg", "icon.svg"]) {
      const source = await readFile(publicPath(name), "utf8");
      expect(source).toContain("<svg");
      const references = [
        ...source.matchAll(/(?:href|xlink:href)\s*=\s*["']([^"']+)/gi),
      ];
      for (const reference of references)
        expect(reference[1]?.startsWith("#")).toBe(true);
    }
  });

  test("declares matching HTML and manifest integration", async () => {
    const html = await readFile(
      resolve(import.meta.dir, "../index.html"),
      "utf8",
    );
    for (const fragment of [
      'href="/favicon.ico" sizes="16x16 32x32 48x48 64x64"',
      'href="/favicon.svg" sizes="any"',
      'href="/favicon-16x16.png" sizes="16x16"',
      'href="/favicon-32x32.png" sizes="32x32"',
      'href="/apple-touch-icon.png" sizes="180x180"',
    ])
      expect(html).toContain(fragment);
    const manifest = JSON.parse(
      await readFile(publicPath("manifest.webmanifest"), "utf8"),
    ) as { icons: unknown[] };
    expect(manifest.icons).toEqual([
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });
});
