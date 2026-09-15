import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "assets/icons");
const output = resolve(root, "public");

interface OutputFile {
  readonly name: string;
  readonly bytes: Buffer;
}

async function render(sourceFile: string, size: number): Promise<Buffer> {
  const svg = await readFile(resolve(source, sourceFile));
  return sharp(svg).resize(size, size, { fit: "fill" }).png().toBuffer();
}

function iconDirectoryEntry(
  size: number,
  bytes: number,
  offset: number,
): Buffer {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(bytes, 8);
  entry.writeUInt32LE(offset, 12);
  return entry;
}

function icoBytes(
  frames: readonly { readonly size: number; readonly png: Buffer }[],
): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length + frames.length * 16;
  const directory = frames.map((frame) => {
    const entry = iconDirectoryEntry(frame.size, frame.png.length, offset);
    offset += frame.png.length;
    return entry;
  });
  return Buffer.concat([
    header,
    ...directory,
    ...frames.map((frame) => frame.png),
  ]);
}

async function expectedOutputs(): Promise<readonly OutputFile[]> {
  const outputs: OutputFile[] = [
    {
      name: "icon.svg",
      bytes: await readFile(resolve(source, "app-icon.svg")),
    },
    {
      name: "favicon.svg",
      bytes: await readFile(resolve(source, "favicon.svg")),
    },
  ];

  const faviconSizes = [16, 32, 48, 64, 128] as const;
  const frames = await Promise.all(
    faviconSizes.map(async (size) => ({
      size,
      png: await render("favicon.svg", size),
    })),
  );
  for (const frame of frames) {
    outputs.push({
      name: `favicon-${frame.size}x${frame.size}.png`,
      bytes: frame.png,
    });
  }
  outputs.push(
    {
      name: "favicon.ico",
      bytes: icoBytes(frames.filter((frame) => frame.size <= 64)),
    },
    {
      name: "apple-touch-icon.png",
      bytes: await render("maskable-icon.svg", 180),
    },
    { name: "icon-192.png", bytes: await render("app-icon.svg", 192) },
    { name: "icon-512.png", bytes: await render("app-icon.svg", 512) },
    {
      name: "icon-maskable-192.png",
      bytes: await render("maskable-icon.svg", 192),
    },
    {
      name: "icon-maskable-512.png",
      bytes: await render("maskable-icon.svg", 512),
    },
  );
  return outputs;
}

async function writeOutputs(outputs: readonly OutputFile[]): Promise<void> {
  await mkdir(output, { recursive: true });
  await Promise.all(
    outputs.map(async (file) => {
      await mkdir(dirname(resolve(output, file.name)), { recursive: true });
      await writeFile(resolve(output, file.name), file.bytes);
    }),
  );
}

async function checkOutputs(outputs: readonly OutputFile[]): Promise<void> {
  const stale: string[] = [];
  for (const file of outputs) {
    try {
      if (!(await readFile(resolve(output, file.name))).equals(file.bytes))
        stale.push(file.name);
    } catch {
      stale.push(`${file.name} (missing)`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Generated icon assets are stale: ${stale.join(", ")}. Run: bun scripts/generate-icons.ts`,
    );
  }
}

async function main(): Promise<void> {
  const outputs = await expectedOutputs();
  if (process.argv.includes("--check")) {
    await checkOutputs(outputs);
  } else {
    await writeOutputs(outputs);
  }
}

await main();
