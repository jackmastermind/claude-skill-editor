'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const iconsDir = path.join(__dirname, 'icons');
const primarySource = path.join(iconsDir, '512x512.png');

if (!fs.existsSync(primarySource)) {
  throw new Error(`Missing primary icon source PNG at ${primarySource}`);
}

let convertChecked = false;

function ensureConvertAvailable() {
  if (convertChecked) {
    return;
  }

  const result = spawnSync('convert', ['-version'], {
    stdio: ['ignore', 'ignore', 'inherit']
  });

  if (result.status !== 0) {
    throw new Error('ImageMagick "convert" command is required to generate icons.');
  }

  convertChecked = true;
}

function loadPng(size) {
  const exactPath = path.join(iconsDir, `${size}x${size}.png`);
  if (fs.existsSync(exactPath)) {
    return fs.readFileSync(exactPath);
  }

  ensureConvertAvailable();

  const result = spawnSync(
    'convert',
    [primarySource, '-resize', `${size}x${size}`, 'PNG32:-'],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );

  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Failed to resize icon to ${size}x${size}`);
  }

  return Buffer.from(result.stdout);
}

function writeIco() {
  const icoPath = path.join(iconsDir, 'claude-skill-editor.ico');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({
    size,
    data: loadPng(size)
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directoryEntries = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    const widthByte = image.size === 256 ? 0 : image.size;
    entry.writeUInt8(widthByte, 0);
    entry.writeUInt8(widthByte, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);

    directoryEntries.push(entry);
    offset += image.data.length;
  }

  const icoBuffer = Buffer.concat([
    header,
    ...directoryEntries,
    ...images.map((image) => image.data)
  ]);

  fs.writeFileSync(icoPath, icoBuffer);
  return icoPath;
}

function writeIcns() {
  const icnsPath = path.join(iconsDir, 'claude-skill-editor.icns');
  const entries = [
    { type: 'icp4', size: 16 },
    { type: 'icp5', size: 32 },
    { type: 'icp6', size: 64 },
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
    { type: 'ic09', size: 512 }
  ];

  const entryBuffers = entries.map(({ type, size }) => {
    const data = loadPng(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });

  const totalLength = entryBuffers.reduce((sum, buffer) => sum + buffer.length, 8);
  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 'ascii');
  fileHeader.writeUInt32BE(totalLength, 4);

  const icnsBuffer = Buffer.concat([fileHeader, ...entryBuffers]);
  fs.writeFileSync(icnsPath, icnsBuffer);
  return icnsPath;
}

const generatedPaths = [writeIco(), writeIcns()];
for (const filePath of generatedPaths) {
  console.log(`Created ${path.relative(process.cwd(), filePath)}`);
}
