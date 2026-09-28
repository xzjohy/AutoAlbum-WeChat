const protocol = require('./protocol');
const log = require('../utils/logger');
const mode = require('./mode');

function ensureReady() {
  if (!protocol.isReady()) throw new Error('请先连接配套墨水屏');
}

function timeCommand(date) {
  const localUnix = Math.round(date.getTime() / 1000) - date.getTimezoneOffset() * 60;
  const year = date.getFullYear();
  return new Uint8Array([
    0xdd,
    localUnix >>> 24, localUnix >>> 16, localUnix >>> 8, localUnix,
    year >> 8, year,
    date.getMonth() + 1,
    date.getDate(),
    date.getDay() || 7
  ]);
}

function parseDateTime(dateText, timeText) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  if (!dateMatch) throw new Error('日期格式应为 YYYY-MM-DD，例如 2026-09-26');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeText || '').trim());
  if (!timeMatch) throw new Error('时间格式应为 HH:mm 或 HH:mm:ss，例如 08:30:00');
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  if (year < 2000 || year > 2099) throw new Error('年份必须在 2000–2099 之间');
  if (month < 1 || month > 12) throw new Error('月份必须在 01–12 之间');
  if (hour > 23 || minute > 59 || second > 59) throw new Error('时间必须在 00:00:00–23:59:59 之间');
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('日期不存在，请检查月份、日期或闰年');
  }
  return date;
}

function localTimeCommand() {
  return timeCommand(new Date());
}

function customTimeCommand(dateText, timeText) {
  return timeCommand(parseDateTime(dateText, timeText));
}

function supportsClockConfiguration() {
  const version = String((protocol.getStatus() || {}).firmwareVersion || '');
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) && major >= 2;
}

async function imageMode() {
  ensureReady();
  const status = await protocol.command(1, new Uint8Array([0xe1, 0]));
  mode.set('image');
  log.info('CTRL', 'image mode');
  return status;
}

async function setClockFace(face, interval = 5) {
  ensureReady();
  if (!supportsClockConfiguration()) {
    throw new Error('当前固件不支持时钟样式和刷新间隔设置，请升级到 2.0.0 或更高版本');
  }
  const style = face === 'analog' ? 1 : 0;
  const minutes = Math.max(1, Math.min(999, Number(interval) || 5));
  const status = await protocol.command(1, new Uint8Array([0xe3, style, minutes & 255, minutes >> 8]));
  log.info('CTRL', `clock face=${style} interval=${minutes}m`);
  return status;
}

async function clockMode(face = 'digital', interval = 5, dateText, timeText) {
  ensureReady();
  const current = protocol.getStatus();
  const configureClock = supportsClockConfiguration()
    ? () => setClockFace(face, interval)
    : () => Promise.resolve();
  const time = dateText && timeText ? customTimeCommand(dateText, timeText) : localTimeCommand();
  if (current && current.scene !== 0) {
    await configureClock();
    const status = await protocol.command(1, time);
    mode.set('clock');
    log.info('CTRL', 'clock time synchronized');
    return status;
  }
  // In image mode, set time first so switching mode causes only one full refresh.
  await configureClock();
  await protocol.command(1, time);
  const status = await protocol.command(1, new Uint8Array([0xe1, 2]));
  mode.set('clock');
  log.info('CTRL', 'clock mode and time synchronized');
  return status;
}

async function disableClockMode() {
  ensureReady();
  const status = await protocol.command(1, new Uint8Array([0xe1, 0]));
  mode.set('off');
  log.info('CTRL', 'clock mode disabled');
  return status;
}

function disableImageMode() {
  mode.set('off');
  log.info('CTRL', 'image mode selection disabled');
  return Promise.resolve(protocol.getStatus());
}

async function syncTime() {
  ensureReady();
  const status = await protocol.command(1, localTimeCommand());
  log.info('CTRL', 'time synchronized');
  return status;
}

async function setTime(dateText, timeText) {
  ensureReady();
  const status = await protocol.command(1, customTimeCommand(dateText, timeText));
  log.info('CTRL', `time set ${dateText} ${timeText}`);
  return status;
}

async function setTemperatureOffset(tenths) {
  ensureReady();
  const value = Math.max(-120, Math.min(120, Math.round(Number(tenths) || 0)));
  const status = await protocol.command(1, new Uint8Array([0xfa, value & 255]));
  log.info('CTRL', `temperature offset=${(value / 10).toFixed(1)}C`);
  return status;
}

async function clear(fill) {
  await imageMode();
  await protocol.command(0, new Uint8Array([0, fill]));
  const status = await protocol.command(0, new Uint8Array([1, 1]));
  log.info('CTRL', fill ? 'clear white' : 'clear black');
  return status;
}

async function fullRefresh() {
  ensureReady();
  const current = protocol.getStatus();
  if (current && current.scene === 0) {
    throw new Error('图片模式请在“图片”页重新同步当前图片以执行全刷');
  }
  const status = await protocol.command(1, new Uint8Array([0xe2]));
  log.info('CTRL', 'clock full refresh');
  return status;
}

function hexToBytes(text) {
  const value = String(text || '').replace(/0x|[\s,]/gi, '');
  if (!value || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error('请输入偶数位十六进制指令');
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function raw(channel, text) {
  ensureReady();
  const bytes = hexToBytes(text);
  const status = await protocol.command(Number(channel), bytes);
  log.info('CTRL', `raw channel=${channel} bytes=${text}`);
  return status;
}

module.exports = {
  imageMode, clockMode, setClockFace, supportsClockConfiguration, disableClockMode, disableImageMode, syncTime, setTime, clear, fullRefresh, raw,
  localTimeCommand, customTimeCommand, parseDateTime, hexToBytes, setTemperatureOffset
};
