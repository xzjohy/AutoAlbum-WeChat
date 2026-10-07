const ble = require('../../services/ble');
const ota = require('../../services/ota');
const protocol = require('../../services/protocol');

function readFile(path) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ filePath: path, success: result => resolve(result.data), fail: reject });
  });
}

function confirmUpdate(name) {
  return new Promise(resolve => wx.showModal({
    title: '确认升级固件',
    content: `即将写入 ${name}。升级期间请保持设备供电并让手机靠近墨水屏。`,
    confirmText: '开始升级',
    confirmColor: '#18cfe0',
    success: result => resolve(result.confirm),
    fail: () => resolve(false)
  }));
}

Page({
  data: {
    connected: false,
    file: null,
    updating: false,
    progress: 0,
    stage: '请选择 .bin 固件（推荐配套2.4.18）'
  },

  onShow() { this.setData({ connected: ble.isConnected() }); },

  async cancelUpdate() { await ota.cancel(); },

  chooseFirmware() {
    if (this.data.updating) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['bin'],
      success: result => {
        const file = result.tempFiles[0];
        this.setData({ file, progress: 0, stage: `已选择 ${file.name}` });
      }
    });
  },

  async updateFirmware() {
    if (!this.data.file || this.data.updating) return;
    if (!await confirmUpdate(this.data.file.name)) return;
    const currentVersion = (protocol.getStatus() || {}).firmwareVersion;
    if (currentVersion) wx.setStorageSync('autoalbum_ota_previous_version', currentVersion);
    this.setData({ updating: true, progress: 0, stage: '正在读取固件' });
    try {
      const buffer = await readFile(this.data.file.path);
      ota.validateFirmware(buffer);
      await ota.update(buffer, state => this.setData(state));
      wx.showModal({
        title: '升级指令已发送',
        content: '墨水屏正在复制固件并重启。请等待约 30 秒，然后重新扫描连接并读取固件版本。激活指令发送完成不代表已验证升级成功。',
        showCancel: false
      });
    } catch (error) {
      this.setData({ stage: error.code === 'OTA_CANCELLED' ? '已取消，请重新连接后从头上传' : '升级失败，请重新连接后从头上传' });
      await ble.disconnect().catch(() => {});
      wx.showModal({ title: error.code === 'OTA_CANCELLED' ? '已取消升级' : 'OTA 升级失败', content: error.message || error.errMsg || String(error), showCancel: false });
    } finally {
      this.setData({ updating: false, connected: ble.isConnected() });
    }
  }
});
