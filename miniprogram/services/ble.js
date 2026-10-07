const cfg = require('../config/ble');
const log = require('../utils/logger');

let deviceId = '';
let serviceId = '';
let characteristicId = '';
let mtu = 23;
let connecting = false;
let connectingId = '';
let connectionLost = false;
let scanCallback = null;
let discoveryQueue = Promise.resolve();
let listenersRegistered = false;
const valueListeners = [];
const characteristicListeners = [];
const disconnectListeners = [];

function p(fn, args = {}) {
  return new Promise((resolve, reject) => fn({ ...args, success: resolve, fail: reject }));
}

function uuid(value) {
  return String(value || '').toUpperCase();
}

function errorText(error) {
  return error && (error.errMsg || error.message) || String(error);
}

async function open() {
  try {
    await p(wx.openBluetoothAdapter);
  } catch (error) {
    if (!/\balready\s+opened\b/i.test(errorText(error))) throw error;
  }
  registerListeners();
  log.info('BLE', 'adapter ready');
}

function registerListeners() {
  if (listenersRegistered) return;
  wx.onBluetoothDeviceFound(result => {
    if (scanCallback) (result.devices || []).forEach(scanCallback);
  });
  wx.onBLECharacteristicValueChange(result => {
    if (result.deviceId !== deviceId) return;
    if (uuid(result.characteristicId) === uuid(characteristicId)) {
      valueListeners.slice().forEach(listener => listener(result.value));
    }
    characteristicListeners.slice().forEach(entry => {
      if (uuid(entry.characteristicId) === uuid(result.characteristicId)) entry.listener(result.value);
    });
  });
  wx.onBLEConnectionStateChange(result => {
    if(result.deviceId === connectingId && !result.connected) connectionLost = true;
    if (result.deviceId !== deviceId || result.connected) return;
    const disconnectedId = deviceId;
    deviceId = '';
    serviceId = '';
    characteristicId = '';
    log.warn('BLE', 'disconnected ' + disconnectedId);
    disconnectListeners.slice().forEach(listener => listener());
  });
  listenersRegistered = true;
}

function queueDiscovery(operation) {
  const result = discoveryQueue.then(operation);
  discoveryQueue = result.catch(() => {});
  return result;
}

async function stopDiscovery() {
  scanCallback = null;
  try {
    await p(wx.stopBluetoothDevicesDiscovery);
  } catch (error) {
    // Discovery may already be stopped.
  }
}

function scan(callback) {
  return queueDiscovery(async () => {
    await stopDiscovery();
    await open();
    scanCallback = callback;
    await p(wx.startBluetoothDevicesDiscovery, { allowDuplicatesKey: true, interval: 500 });
    try {
      const cached = await p(wx.getBluetoothDevices);
      (cached.devices || []).forEach(callback);
    } catch (error) {
      log.warn('BLE', 'cached devices unavailable ' + errorText(error));
    }
    log.info('BLE', 'scan started');
  });
}

function stopScan() {
  return queueDiscovery(stopDiscovery);
}

async function discoverCharacteristic(id) {
  const services = await p(wx.getBLEDeviceServices, { deviceId: id });
  const service = (services.services || []).find(item => uuid(item.uuid) === uuid(cfg.serviceUUID));
  if (!service) throw new Error('设备不是配套墨水屏：未找到图片服务');
  const characteristics = await p(wx.getBLEDeviceCharacteristics, {
    deviceId: id,
    serviceId: service.uuid
  });
  const characteristic = (characteristics.characteristics || []).find(
    item => uuid(item.uuid) === uuid(cfg.characteristicUUID)
  );
  if (!characteristic) throw new Error('设备固件不匹配：未找到图片传输特征值');
  if (!characteristic.properties || !characteristic.properties.write) {
    throw new Error('设备图片特征值不支持可靠写入');
  }
  if (!characteristic.properties.notify && !characteristic.properties.indicate) {
    throw new Error('设备固件过旧：图片特征值不支持状态通知');
  }
  return { serviceId: service.uuid, characteristicId: characteristic.uuid };
}

async function findCharacteristic(targetServiceUUID, targetCharacteristicUUID) {
  if (!deviceId) throw new Error('请先连接墨水屏');
  const services = await p(wx.getBLEDeviceServices, { deviceId });
  const service = (services.services || []).find(item => uuid(item.uuid) === uuid(targetServiceUUID));
  if (!service) throw new Error('设备未提供所需蓝牙服务');
  const result = await p(wx.getBLEDeviceCharacteristics, { deviceId, serviceId: service.uuid });
  const characteristic = (result.characteristics || []).find(
    item => uuid(item.uuid) === uuid(targetCharacteristicUUID)
  );
  if (!characteristic) throw new Error('设备未提供所需蓝牙特征值');
  return { serviceId: service.uuid, characteristicId: characteristic.uuid, properties: characteristic.properties || {} };
}

async function negotiateMTU(id) {
  try {
    await p(wx.setBLEMTU, { deviceId: id, mtu: cfg.preferredMTU });
  } catch (error) {
    log.warn('BLE', 'MTU request skipped ' + errorText(error));
  }
  try {
    const result = await p(wx.getBLEMTU, { deviceId: id, writeType: cfg.writeType });
    if (result.mtu) mtu = result.mtu;
  } catch (error) {
    log.warn('BLE', 'MTU query unavailable; using 23');
  }
  log.info('BLE', 'MTU ' + mtu);
}

async function connect(id) {
  if(connecting) throw new Error('正在连接，请等待');
  connecting = true;
  try {
    await stopScan();
    await open();
    if(deviceId) await disconnect();
    for(let attempt=0;attempt<2;attempt++) {
      connectingId=id; connectionLost=false; mtu=23;
      const check=()=>{if(connectionLost)throw new Error('GATT disconnected during discovery');};
      try {
        await p(wx.createBLEConnection, {deviceId:id,timeout:10000});
        check();
        await negotiateMTU(id);check();
        const found=await discoverCharacteristic(id);check();
        deviceId=id;serviceId=found.serviceId;characteristicId=found.characteristicId;
        await p(wx.notifyBLECharacteristicValueChange,{deviceId,serviceId,characteristicId,state:true});
        check();log.info('BLE','connected '+id);return;
      } catch(error) {
        try {await p(wx.closeBLEConnection,{deviceId:id});}catch(ignored){}
        deviceId='';serviceId='';characteristicId='';
        const transient=[10003,10006,10012].includes(error.errCode)||/147|GATT|disconnect|timeout|connection fail/i.test(errorText(error));
        if(attempt||!transient)throw error;
        log.warn('BLE','retry after connection failure; release other phone/web clients');
        connectingId='';await new Promise(resolve=>setTimeout(resolve,1500));
      }
    }
  } finally {connecting=false;connectingId='';}
}

async function disconnect() {
  if (!deviceId) return;
  const id = deviceId;
  deviceId = '';
  serviceId = '';
  characteristicId = '';
  await p(wx.closeBLEConnection, { deviceId: id });
  log.info('BLE', 'disconnected ' + id);
  disconnectListeners.slice().forEach(listener => listener());
}

// Release the link when the mini program is no longer active.  Turning off
// notifications first lets the firmware return to advertising immediately;
// disconnect() remains safe to call repeatedly.
async function release() {
  await stopScan();
  if (!deviceId) return;
  const target = { deviceId, serviceId, characteristicId };
  if (target.serviceId && target.characteristicId) {
    try {
      await p(wx.notifyBLECharacteristicValueChange, {
        deviceId: target.deviceId,
        serviceId: target.serviceId,
        characteristicId: target.characteristicId,
        state: false
      });
    } catch (error) {
      // A peripheral may already have stopped notifications while disconnecting.
      log.warn('BLE', 'stop notifications skipped ' + errorText(error));
    }
  }
  await disconnect();
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function write(value) {
  if (!deviceId || !serviceId || !characteristicId) throw new Error('请先连接墨水屏');
  return p(wx.writeBLECharacteristicValue, {
    deviceId, serviceId, characteristicId,
    value: toArrayBuffer(value),
    writeType: cfg.writeType
  });
}

async function enableNotifications(target) {
  if (!deviceId) throw new Error('请先连接墨水屏');
  await p(wx.notifyBLECharacteristicValueChange, {
    deviceId,
    serviceId: target.serviceId,
    characteristicId: target.characteristicId,
    state: true
  });
}

async function writeCharacteristic(target, value, writeType = cfg.writeType) {
  if (!deviceId) throw new Error('请先连接墨水屏');
  return p(wx.writeBLECharacteristicValue, {
    deviceId,
    serviceId: target.serviceId,
    characteristicId: target.characteristicId,
    value: toArrayBuffer(value),
    writeType
  });
}

function addUnique(list, listener) {
  if (!list.includes(listener)) list.push(listener);
  return () => {
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  };
}

module.exports = {
  scan,
  stopScan,
  connect,
  disconnect,
  release,
  write,
  findCharacteristic,
  enableNotifications,
  writeCharacteristic,
  onValue: listener => addUnique(valueListeners, listener),
  onCharacteristicValue: (targetCharacteristicId, listener) => {
    const entry = { characteristicId: targetCharacteristicId, listener };
    characteristicListeners.push(entry);
    return () => {
      const index = characteristicListeners.indexOf(entry);
      if (index >= 0) characteristicListeners.splice(index, 1);
    };
  },
  onDisconnect: listener => addUnique(disconnectListeners, listener),
  isConnected: () => !!deviceId,
  getDeviceId: () => deviceId,
  getImageChunkSize: () => Math.max(12, Math.min(236, mtu - 11)),
  getRawWriteSize: () => Math.max(20, Math.min(244, mtu - 3)),
  isLikelyScreen: device => (device.name || device.localName || '').startsWith(cfg.deviceNamePrefix)
};
