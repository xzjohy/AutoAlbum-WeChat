const cfg = require('../config/ble');

const ink = require('./epaper-pixels');

function applyGrayscale(data, amount) {
  const strength = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  if (!strength) return;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    data[index] += (gray - data[index]) * strength;
    data[index + 1] += (gray - data[index + 1]) * strength;
    data[index + 2] += (gray - data[index + 2]) * strength;
  }
}

function packPlanes(data, width, height, monochrome = false) {
  const stride = Math.ceil(width / 8);
  const black = new Uint8Array(stride * height);
  const red = new Uint8Array(stride * height);
  black.fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const color = ink.color(data[index], data[index + 1], data[index + 2], data[index + 3], monochrome);
      const offset = y * stride + (x >> 3);
      const mask = 0x80 >> (x & 7);
      if (color === 0) black[offset] &= ~mask;
      else if (color === 2) red[offset] |= mask;
    }
  }
  return { black, red };
}

function loadImage(canvas, path) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = error => reject(new Error('图片解码失败：' + (error.errMsg || error.message || error)));
    image.src = path;
  });
}

async function convertUncached(path, options = {}) {
  if (!wx.createOffscreenCanvas) throw new Error('当前微信版本不支持图片离屏处理，请升级微信');
  const width = cfg.screen.width;
  const height = cfg.screen.height;
  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
  const context = canvas.getContext('2d');
  const image = await loadImage(canvas, path);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  const imageData = context.getImageData(0, 0, width, height);
  applyGrayscale(imageData.data, options.monochrome ? 0 : options.grayscale);
  // Preserve light text strokes directly; error diffusion can break glyphs.
  return packPlanes(imageData.data, width, height, !!options.monochrome);
}

// Keep only recent packed results; never put typed arrays in page setData.
const converted = new Map();
function conversionKey(path, options = {}) {
  return JSON.stringify([path, Number(options.grayscale) || 0, !!options.monochrome, 'stroke-preserve-184-v1']);
}
async function convert(path, options = {}) {
  const key = conversionKey(path, options);
  if (converted.has(key)) return converted.get(key);
  const planes = await convertUncached(path, options);
  converted.set(key, planes);
  while (converted.size > 8) converted.delete(converted.keys().next().value);
  return planes;
}
function unpackPlanes(planes, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const stride = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * stride + (x >> 3), mask = 0x80 >> (x & 7);
    const red = !!(planes.red[offset] & mask);
    const white = !!(planes.black[offset] & mask) && !red;
    const i = (y * width + x) * 4;
    pixels[i] = red || white ? 255 : 0;
    pixels[i + 1] = pixels[i + 2] = white ? 255 : 0;
    pixels[i + 3] = 255;
  }
  return pixels;
}
async function preview(path, options, canvas) {
  const planes = await convert(path, options);
  const { width, height } = cfg.screen;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const frame = context.createImageData(width, height);
  frame.data.set(unpackPlanes(planes, width, height));
  context.putImageData(frame, 0, 0);
  const result = await new Promise((resolve, reject) => wx.canvasToTempFilePath({
    canvas, x: 0, y: 0, width, height, destWidth: width, destHeight: height,
    fileType: 'png', success: resolve, fail: reject
  }));
  return { previewPath: result.tempFilePath, packedBytes: planes.black.length + planes.red.length };
}
module.exports = { convert, preview, packPlanes, unpackPlanes, applyGrayscale, conversionKey };
