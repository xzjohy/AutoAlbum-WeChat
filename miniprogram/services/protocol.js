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
const idleWaiters = [];
let lastStatusSignature = '';
const operationListeners = [];
let commandQueue = Promise.resolve();

function emitOperation(type, detail = {}) {
  const event = Object.assign({ type, at: Date.now() }, detail);
  operationListeners.slice().forEach(listener => listener(event));
}

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
  while (idleWaiters.length) idleWaiters.shift().reject(new Error(message));
}

function receive(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || bytes[0] !== 0xe5 || bytes[1] < 1) return;
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
    firmwareVersion: bytes.length >= 19 ? `${bytes[16]}.${bytes[17]}.${bytes[18]}` : '',
    tempOffsetTenths: bytes.length >= 20 ? (bytes[19] > 127 ? bytes[19] - 256 : bytes[19]) : null,
    idleDisconnectMinutes: bytes.length >= 22 ? bytes[20] | bytes[21] << 8 : null,
    capabilities: bytes.length >= 23 ? bytes[22] : 0,
    batteryVisible: bytes.length >= 24 ? !!bytes[23] : true,
    batteryLevel: bytes.length >= 25 ? bytes[24] : null,
    clockRefreshMode: bytes.length >= 26 && bytes[25] === 1 ? 'partial' : 'full',
    clockIntervalMinutes: bytes.length >= 28 ? bytes[26] | bytes[27] << 8 : null,
    clockNow: bytes.length >= 37 ? (bytes[28] | bytes[29] << 8 | bytes[30] << 16 | bytes[31] << 24) >>> 0 : null,
    clockLastRefresh: bytes.length >= 37 ? (bytes[32] | bytes[33] << 8 | bytes[34] << 16 | bytes[35] << 24) >>> 0 : null,
    clockRuntimeFlags: bytes.length >= 37 ? bytes[36] : 0
  };
  const signature = Array.prototype.map.call(bytes, value => value.toString(16).padStart(2, '0')).join(' ');
  if (!lastStatusSignature) {
    log.info('EPD', `E5 状态包 ${signature}`);
    lastStatusSignature = signature;
  }
  lastStatus = status;
  busy = (status.state >= 1 && status.state <= 4) || !!status.busy;
  emitOperation('status', { status, busy });
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
  if (!busy && !pending) {
    while (idleWaiters.length) idleWaiters.shift().resolve();
    emitOperation('idle');
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

function waitForIdle(timeoutMs = 150000) {
  if (!ready) return Promise.reject(new Error('设备状态服务未就绪，请重新连接'));
  if (!pending && !busy) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => { clearTimeout(waiter.timer); resolve(); },
      reject: error => { clearTimeout(waiter.timer); reject(error); }
    };
    waiter.timer = setTimeout(() => {
      const index = idleWaiters.indexOf(waiter);
      if (index >= 0) idleWaiters.splice(index, 1);
      reject(new Error('设备长时间未释放屏幕操作，请取消等待并重新连接'));
    }, timeoutMs);
    idleWaiters.push(waiter);
    emitOperation('waiting', { status: lastStatus, timeoutMs });
    ble.write(new Uint8Array([5])).catch(() => {});
  });
}

function command(channel, value) {
  const body = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (!ready) return Promise.reject(new Error('设备状态服务未就绪，请重新连接'));
  if (!body.length || body.length > 243) return Promise.reject(new Error('指令长度超限'));
  const task = commandQueue
    .catch(() => {})
    .then(() => waitForIdle())
    .then(() => sendCommand(channel, body));
  commandQueue = task;
  return task;
}

function sendCommand(channel, body) {
  if (pending || busy) return Promise.reject(new Error('墨水屏仍在处理上一条指令'));
  const token = sequence;
  sequence = token % 65535 + 1;
  const packet = new Uint8Array(body.length + 4);
  packet.set([6, token & 255, token >> 8, channel]);
  packet.set(body, 4);
  return new Promise((resolve, reject) => {
    const isLongOperation = body[0] === 1 || body[0] === 0xe1 || body[0] === 0xe2 || body[0] === 0xe3 || body[0] === 0xe6 || body[0] === 0xdd;
    const timer = setTimeout(() => {
      if (!pending || pending.token !== token) return;
      pending = null;
      reject(new Error('等待设备执行结果超时，结果未知，请重新连接'));
    }, isLongOperation ? 140000 : 30000);
    pending = { token, resolve, reject, timer };
    emitOperation('sent', { token, channel, command: body[0] });
    ble.write(packet).catch(error => {
      if (!pending || pending.token !== token) return;
      pending = null;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function cancelWaiting(reason = '已取消等待，设备当前刷新不会被中断') {
  while (idleWaiters.length) idleWaiters.shift().reject(new Error(reason));
  emitOperation('wait-cancelled');
}

function requestStatus() {
  if (!ready) return Promise.reject(new Error('请先连接设备'));
  return new Promise((resolve, reject) => {
    const remove = () => {
      clearTimeout(timer);
      const index = statusListeners.indexOf(listener);
      if (index >= 0) statusListeners.splice(index, 1);
    };
    const listener = status => { remove(); resolve(status); };
    const timer = setTimeout(() => { remove(); reject(new Error('设备状态回读超时')); }, 5000);
    statusListeners.push(listener);
    ble.write(new Uint8Array([5])).catch(error => { remove(); reject(error); });
  });
}

module.exports = {
  start,
  command,
  requestStatus,
  waitForIdle,
  cancelWaiting,
  close: () => clearState('连接已关闭'),
  abort: (reason = '操作已取消') => clearState(reason),
  isReady: () => ready,
  isBusy: () => busy || !!pending,
  getStatus: () => lastStatus,
  setStatusListener: listener => { statusListener = listener || null; },
  onOperation: listener => {
    if (!operationListeners.includes(listener)) operationListeners.push(listener);
    return () => {
      const index = operationListeners.indexOf(listener);
      if (index >= 0) operationListeners.splice(index, 1);
    };
  },
  onStatus: listener => {
    if (!statusListeners.includes(listener)) statusListeners.push(listener);
    return () => {
      const index = statusListeners.indexOf(listener);
      if (index >= 0) statusListeners.splice(index, 1);
    };
  },
  reason: errorReason
};
