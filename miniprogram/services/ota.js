const cfg = require('../config/ble');
const ble = require('./ble');
const protocol = require('./protocol');
const log = require('../utils/logger');

const BANK_START = 0x20000;
const BANK_SIZE = 0x20000;
const WRITABLE_LIMIT = BANK_SIZE - 0x100;
const SECTOR_SIZE = 0x1000;
const PAGE_SIZE = 0x100;
let running = false;

function addressBytes(address) {
  return [address >>> 24, address >>> 16, address >>> 8, address];
}

function validateFirmware(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || bytes.length > WRITABLE_LIMIT) {
    throw new Error('固件大小必须在 12 字节到 130816 字节之间');
  }
  if (bytes[8] !== 0x4b || bytes[9] !== 0x4e || bytes[10] !== 0x4c || bytes[11] !== 0x54) {
    throw new Error('文件不是有效的 Telink KNLT 固件');
  }
  return bytes;
}

function checksum(bytes) {
  let sum = 0;
  for (let index = 0; index < BANK_SIZE; index++) sum = (sum + (index < bytes.length ? bytes[index] : 0xff)) & 0xffff;
  return sum;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForChecksum(target, expected) {
  let removeListener;
  let timer;
  const result = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (removeListener) removeListener();
      reject(new Error('等待设备校验固件超时'));
    }, 30000);
    removeListener = ble.onCharacteristicValue(target.characteristicId, buffer => {
      const value = new Uint8Array(buffer);
      if (value.length !== 3 || value[0] !== 7) return;
      clearTimeout(timer);
      removeListener();
      resolve((value[1] << 8) | value[2]);
    });
  });
  try {
    const values = await Promise.all([
      ble.writeCharacteristic(target, new Uint8Array([6])),
      result
    ]);
    const remote = values[1];
    if (remote !== expected) throw new Error(`固件校验不一致：本地 ${expected.toString(16)}，设备 ${remote.toString(16)}`);
  } finally {
    clearTimeout(timer);
    if (removeListener) removeListener();
  }
}

async function update(buffer, onProgress) {
  if (running) throw new Error('固件升级正在进行');
  if (!ble.isConnected()) throw new Error('请先连接墨水屏');
  const firmware = validateFirmware(buffer);
  const expected = checksum(firmware);
  running = true;
  try {
    const target = await ble.findCharacteristic(cfg.otaServiceUUID, cfg.otaCharacteristicUUID);
    if (!target.properties.write) throw new Error('设备 OTA 特征值不可写');
    await ble.enableNotifications(target);
    protocol.close();
    log.info('OTA', `start ${firmware.length} bytes checksum ${expected.toString(16)}`);

    for (let address = BANK_START; address < BANK_START + BANK_SIZE; address += SECTOR_SIZE) {
      await ble.writeCharacteristic(target, new Uint8Array([1, ...addressBytes(address)]));
      const erased = (address - BANK_START + SECTOR_SIZE) / BANK_SIZE;
      onProgress && onProgress({ progress: Math.round(erased * 10), stage: '正在擦除升级区' });
    }

    const rawSize = ble.getRawWriteSize();
    const chunkSize = Math.min(240, rawSize - 1);
    for (let pageOffset = 0; pageOffset < firmware.length; pageOffset += PAGE_SIZE) {
      const page = firmware.subarray(pageOffset, Math.min(pageOffset + PAGE_SIZE, firmware.length));
      for (let offset = 0; offset < page.length; offset += chunkSize) {
        const chunk = page.subarray(offset, Math.min(offset + chunkSize, page.length));
        const command = new Uint8Array(chunk.length + 1);
        command[0] = 3;
        command.set(chunk, 1);
        await ble.writeCharacteristic(target, command);
      }
      const address = BANK_START + pageOffset;
      await ble.writeCharacteristic(target, new Uint8Array([2, ...addressBytes(address)]));
      await delay(50);
      const written = Math.min(firmware.length, pageOffset + page.length);
      onProgress && onProgress({
        progress: 10 + Math.round(written / firmware.length * 80),
        stage: `正在写入固件 ${written}/${firmware.length} 字节`
      });
    }

    onProgress && onProgress({ progress: 92, stage: '正在校验设备端固件' });
    // Compatibility with the previous firmware: it accidentally read the
    // echoed CRC from its reply buffer. Prime those two bytes before command 6.
    await ble.writeCharacteristic(target, new Uint8Array([3, 0, 0, 0, 0, 0, expected >> 8, expected & 255]));
    await ble.writeCharacteristic(target, new Uint8Array([5, 0, 0, 0, 0]));
    await waitForChecksum(target, expected);
    onProgress && onProgress({ progress: 98, stage: '校验通过，设备即将重启' });
    const finish = new Uint8Array([7, 0xc0, 0x01, 0xce, 0xed, expected >> 8, expected & 255]);
    try { await ble.writeCharacteristic(target, finish); } catch (error) {
      // A verified device can disconnect immediately while copying and rebooting.
      if (ble.isConnected()) throw error;
    }
    onProgress && onProgress({ progress: 100, stage: '升级指令已发送，请等待设备重启' });
    log.info('OTA', 'verified and reboot command sent');
  } finally {
    running = false;
  }
}

module.exports = { update, validateFirmware, checksum, isRunning: () => running };
