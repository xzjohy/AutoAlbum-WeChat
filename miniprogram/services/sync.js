const ble = require('./ble');
const protocol = require('./protocol');
const image = require('./image');
const log = require('../utils/logger');
const mode = require('./mode');
const cfg = require('../config/ble');

let cancelled = false;

function ensureNotCancelled() {
  if (cancelled) throw new Error('图片传输已终止');
}

function beginTransfer() {
  cancelled = false;
}

function cancel() {
  cancelled = true;
  protocol.abort('图片传输已由用户终止');
}

function validatePlanes(planes) {
  const expected = Math.ceil(cfg.screen.width / 8) * cfg.screen.height;
  if (!planes || !(planes.black instanceof Uint8Array) || !(planes.red instanceof Uint8Array) ||
      planes.black.length !== expected || planes.red.length !== expected) {
    throw new Error('图片数据大小不符合屏幕要求，已停止发送，请重新转换');
  }
}

function crc16(data) {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc;
}

function supportsStoredCarousel() {
  const status = protocol.getStatus();
  const parts = status && String(status.firmwareVersion || '').split('.').map(Number);
  return !!parts && (parts[0] > 1 || (parts[0] === 1 && parts[1] >= 2));
}

async function sendPlane(data, layer, report) {
  const chunkSize = ble.getImageChunkSize();
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    ensureNotCancelled();
    const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
    const command = new Uint8Array(chunk.length + 4);
    command.set([3, layer, offset >> 8, offset & 255]);
    command.set(chunk, 4);
    await protocol.command(0, command);
    report(Math.min(1, (offset + chunk.length) / data.length));
  }
}

async function upload(item, index, total, onProgress, monochrome) {
  ensureNotCancelled();
  log.info('SYNC', `processing ${index + 1}/${total}`);
  onProgress && onProgress({ index, total, stage: '正在处理图片', overall: index / total });
  const planes = await image.convert(item.path, {
    grayscale: item.grayscale == null ? 0 : item.grayscale,
    monochrome
  });
  ensureNotCancelled();
  validatePlanes(planes);
  const progress = value => onProgress && onProgress({
    index,
    total,
    stage: '正在传输图片',
    fileProgress: value,
    overall: (index + value) / total
  });

  const selected = await protocol.command(1, new Uint8Array([0xe1, 0]));
  if (selected.scene !== 0) throw new Error('设备未进入图片模式');
  mode.set('image');
  await protocol.command(0, new Uint8Array([0, 0]));
  await protocol.command(0, new Uint8Array([2, 0, 0]));
  await sendPlane(planes.black, 0xff, value => progress(value * 0.48));
  await sendPlane(planes.red, 0x00, value => progress(0.48 + value * 0.48));

  const blackCrc = crc16(planes.black);
  const redCrc = crc16(planes.red);
  await protocol.command(0, new Uint8Array([
    8, blackCrc >> 8, blackCrc & 255, redCrc >> 8, redCrc & 255
  ]));
  onProgress && onProgress({ index, total, stage: '墨水屏正在刷新', fileProgress: 0.98, overall: (index + 0.98) / total });
  const completed = await protocol.command(0, new Uint8Array([1, monochrome ? 2 : 1]));
  if (completed.scene !== 0) throw new Error('设备刷新模式异常');
  progress(1);
  log.info('SYNC', `completed ${index + 1}/${total}`);
}

async function start(items, onProgress, options = {}) {
  if (!ble.isConnected() || !protocol.isReady()) throw new Error('请先连接配套墨水屏');
  if (!items.length) throw new Error('请先添加图片');
  beginTransfer();
  for (let index = 0; index < items.length; index++) {
    ensureNotCancelled();
    await upload(items[index], index, items.length, onProgress, !!options.monochrome);
  }
}

async function stopStoredCarousel() {
  if (!ble.isConnected() || !protocol.isReady()) throw new Error('请先连接配套墨水屏');
  if (!supportsStoredCarousel()) throw new Error('当前固件不支持离线轮播，请先在“升级”页安装 1.2.0 或更高版本');
  return protocol.command(0, new Uint8Array([0x0b]));
}

async function resumeStoredCarousel() {
  if (!ble.isConnected() || !protocol.isReady()) throw new Error('请先连接配套墨水屏');
  if (!supportsStoredCarousel()) throw new Error('当前固件不支持离线轮播，请先升级固件');
  return protocol.command(0, new Uint8Array([0x0c]));
}

async function configureStoredCarousel(count, minutes) {
  if (!supportsStoredCarousel()) throw new Error('请先升级到支持离线轮播的固件');
  if (!Number.isInteger(count) || count < 1 || count > 4 ||
      !Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new Error('图片数量或间隔无效');
  return protocol.command(0, new Uint8Array([10, count, minutes, 0]));
}

async function storeCarousel(items, intervalMinutes, onProgress) {
  if (!ble.isConnected() || !protocol.isReady()) throw new Error('请先连接配套墨水屏');
  if (!supportsStoredCarousel()) throw new Error('离线三色轮播需要 1.2.0 或更高固件，请先在“升级”页更新');
  if (!items.length || items.length > 4) throw new Error('三色离线轮播需要 1–4 张图片');
  beginTransfer();
  const minutes = Math.max(5, Math.min(120, Number(intervalMinutes) || 5));
  await stopStoredCarousel();
  for (let index = 0; index < items.length; index++) {
    ensureNotCancelled();
    const item = items[index];
    onProgress && onProgress({ index, total: items.length, stage: `正在处理第 ${index + 1} 张`, overall: index / items.length });
    const planes = await image.convert(item.path, { grayscale: item.grayscale || 0, monochrome: false });
    ensureNotCancelled();
    validatePlanes(planes);
    await protocol.command(0, new Uint8Array([0, 255]));
    await protocol.command(0, new Uint8Array([2, 0, 0]));
    await sendPlane(planes.black, 0xff, value => onProgress && onProgress({
      index,
      total: items.length,
      stage: `正在写入第 ${index + 1}/${items.length} 张`,
      fileProgress: value,
      overall: (index + value * 0.45) / items.length
    }));
    await sendPlane(planes.red, 0x00, value => onProgress && onProgress({
      index,
      total: items.length,
      stage: `正在写入第 ${index + 1}/${items.length} 张红色层`,
      fileProgress: value,
      overall: (index + 0.45 + value * 0.45) / items.length
    }));
    const blackCrc = crc16(planes.black);
    const redCrc = crc16(planes.red);
    await protocol.command(0, new Uint8Array([8, blackCrc >> 8, blackCrc & 255, redCrc >> 8, redCrc & 255]));
    await protocol.command(0, new Uint8Array([9, index]));
    onProgress && onProgress({ index, total: items.length, stage: `第 ${index + 1} 张已保存`, overall: (index + 1) / items.length });
  }
  const status = await protocol.command(0, new Uint8Array([10, items.length, minutes & 255, minutes >> 8]));
  mode.set('image');
  log.info('SYNC', `stored carousel count=${items.length} interval=${minutes}m`);
  return status;
}

module.exports = { start, storeCarousel, stopStoredCarousel, resumeStoredCarousel, supportsStoredCarousel, configureStoredCarousel, cancel, crc16, validatePlanes };
