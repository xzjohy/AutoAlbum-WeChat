const protocol = require('./protocol');

const KEY = 'autoalbum_idle_disconnect_minutes';

function normalize(value) {
  const parsed = parseInt(value, 10);
  return Math.max(1, Math.min(999, Number.isFinite(parsed) ? parsed : 1));
}

function get() {
  return normalize(wx.getStorageSync(KEY));
}

async function apply(minutes) {
  const value = normalize(minutes);
  if (!protocol.isReady()) throw new Error('请先连接墨水屏');
  // E4: idle BLE release interval in LE16 minutes.
  await protocol.command(1, new Uint8Array([0xe4, value & 255, value >> 8]));
  wx.setStorageSync(KEY, value);
  return value;
}

module.exports = { get, apply, normalize };
