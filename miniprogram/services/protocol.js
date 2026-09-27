const ble = require('./ble');
const log = require('../utils/logger');

const reasons = [
  '', '设备正忙，指令未执行', '指令或图片数据无效',
  '屏幕初始化失败，请检查屏幕型号、供电和接线',
  '屏幕 BUSY 超时', '图片解码失败', '图片上传超时',
  '未检测到屏幕 BUSY，请检查接线', '图片图层校验失败', 'Flash 保存或回读校验失败，请重新上传'
];

let sequence = 1 + Math.floor(Math.random() * 60000);
let ready = false;
let busy = false;
let hello = null;
let pending = null;
let removeValueListener = null;
let removeDisconnectListener = null;
let pollTimer = null;
let statusListener = null;
const statusListeners = [];
let lastStatus = null;
let lastStatusSignature = '';

function errorReason(code) {
  return reasons[code] || '设备返回未知错误 ' + code;
}

function clearState(message) {
  clearInterval(pollTimer);
  pollTimer = null;
  ready = false;
  busy = false;
  lastStatus = null;
  lastStatusSignature = '';
  if (hello) {
    clearTimeout(hello.timer);
    hello.reject(new Error(message));
    hello = null;
  }
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
    pending = null;
  }
}

function receive(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || bytes[0] !== 0xe5 || bytes[1] !== 1) return;
  const status = {
    token: bytes[2] | bytes[3] << 8,
    state: bytes[4],
    reason: bytes[5],
    scene: bytes[6],
    busy: bytes[7],
    seconds: bytes[8] | bytes[9] << 8,
    command: bytes[10],
    channel: bytes[11],
    carouselRunning: bytes.length >= 15 ? !!bytes[12] : false,
    carouselEnabled: bytes.length >= 15 && (!!bytes[12] || (bytes.length >= 16 && !!bytes[15])),
    carouselIndex: bytes.length >= 15 ? bytes[13] : 0,
    carouselCount: bytes.length >= 15 ? bytes[14] : 0,
    carouselPaused: bytes.length >= 16 ? !!bytes[15] : false,
    firmwareVersion: bytes.length >= 19 ? `${bytes[16]}.${bytes[17]}.${bytes[18]}` : ''
  };
  const signature = Array.prototype.map.call(bytes, value => value.toString(16).padStart(2, '0')).join(' ');
  if (!lastStatusSignature) {
    log.info('EPD', `E5 状态包 ${signature}`);
    lastStatusSignature = signature;
  }
  lastStatus = status;
  busy = (status.state >= 1 && status.state <= 4) || !!status.busy;
  if (statusListener) statusListener(status);
  statusListeners.slice().forEach(listener => listener(status));
  if (hello) {
    const current = hello;
    hello = null;
    clearTimeout(current.timer);
    ready = true;
    sequence = (status.token + 1) % 65535 || 1;
    current.resolve(status);
  }
  if (pending && status.token === pending.token && status.state >= 5) {
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (status.state === 5) current.resolve(status);
    else current.reject(new Error(errorReason(status.reason)));
  }
}

async function start(listener) {
  statusListener = listener || null;
  if (removeValueListener) removeValueListener();
  if (removeDisconnectListener) removeDisconnectListener();
  removeValueListener = ble.onValue(receive);
  removeDisconnectListener = ble.onDisconnect(() => clearState('蓝牙连接已断开'));
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hello = null;
      reject(new Error('未收到设备状态回复，请确认已烧录配套固件'));
    }, 5000);
    hello = { resolve, reject, timer };
  });
  let status;
  try {
    const result = await Promise.all([ble.write(new Uint8Array([5])), response]);
    status = result[1];
  } catch (error) {
    clearState(error.message || String(error));
    throw error;
  }
  pollTimer = setInterval(() => {
    if (pending || busy || (lastStatus && lastStatus.carouselRunning)) ble.write(new Uint8Array([5])).catch(() => {});
  }, 2000);
  log.info('EPD', 'status protocol ready');
  return status;
}

function command(channel, value) {
  const body = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (!ready) return Promise.reject(new Error('设备状态服务未就绪，请重新连接'));
  if (pending || busy) return Promise.reject(new Error('墨水屏仍在处理上一条指令'));
  if (!body.length || body.length > 243) return Promise.reject(new Error('指令长度超限'));
  const token = sequence;
  sequence = token % 65535 + 1;
  const packet = new Uint8Array(body.length + 4);
  packet.set([6, token & 255, token >> 8, channel]);
  packet.set(body, 4);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending || pending.token !== token) return;
      pending = null;
      reject(new Error('等待设备执行结果超时，结果未知，请重新连接'));
    }, 140000);
    pending = { token, resolve, reject, timer };
    ble.write(packet).catch(error => {
      if (!pending || pending.token !== token) return;
      pending = null;
      clearTimeout(timer);
      reject(error);
    });
  });
}

module.exports = {
  start,
  command,
  close: () => clearState('连接已关闭'),
  abort: (reason = '操作已取消') => clearState(reason),
  isReady: () => ready,
  getStatus: () => lastStatus,
  onStatus: listener => {
    if (!statusListeners.includes(listener)) statusListeners.push(listener);
    return () => {
      const index = statusListeners.indexOf(listener);
      if (index >= 0) statusListeners.splice(index, 1);
    };
  },
  reason: errorReason
};
