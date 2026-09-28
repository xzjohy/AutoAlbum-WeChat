const ble = require('./ble');
const protocol = require('./protocol');
const control = require('./control');
const log = require('../utils/logger');

const KEY = 'autoalbum_online_clock';
let timer = null;
let synchronizing = false;

function normalize(value) {
  return Math.max(1, Math.min(999, parseInt(value, 10) || 5));
}

function settings() {
  const saved = wx.getStorageSync(KEY) || {};
  return { enabled: !!saved.enabled, intervalMinutes: normalize(saved.intervalMinutes) };
}

async function tick() {
  if (synchronizing || !ble.isConnected() || !protocol.isReady() || protocol.isBusy()) return;
  synchronizing = true;
  try {
    await control.syncTime();
    log.info('CLOCK', 'online time synchronized');
  } catch (error) {
    log.warn('CLOCK', `online sync skipped: ${error.message || error.errMsg || error}`);
  } finally {
    synchronizing = false;
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function start() {
  stop();
  const current = settings();
  if (!current.enabled) return;
  timer = setInterval(tick, current.intervalMinutes * 60 * 1000);
  log.info('CLOCK', `online sync every ${current.intervalMinutes}m`);
}

function configure(next) {
  const current = Object.assign(settings(), next || {});
  current.enabled = !!current.enabled;
  current.intervalMinutes = normalize(current.intervalMinutes);
  wx.setStorageSync(KEY, current);
  start();
  if (current.enabled) tick();
  return current;
}

module.exports = { settings, configure, start, stop, tick };
