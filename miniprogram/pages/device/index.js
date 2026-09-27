const ble = require('../../services/ble');
const protocol = require('../../services/protocol');
const modeState = require('../../services/mode');

function displayName(device) {
  return device.localName || device.name || '未命名设备';
}

Page({
  data: {
    devices: [],
    scanning: false,
    connecting: false,
    connected: false,
    deviceId: '',
    screenStatus: '',
    firmwareVersion: ''
  },

  onLoad() {
    this.removeDisconnectListener = ble.onDisconnect(() => {
      modeState.set('off');
      this.setData({ connected: false, deviceId: '', connecting: false, screenStatus: '连接已断开', firmwareVersion: '' });
    });
  },

  onShow() {
    const status = protocol.getStatus();
    this.setData({
      connected: ble.isConnected(),
      deviceId: ble.getDeviceId(),
      firmwareVersion: status && status.firmwareVersion || ''
    });
  },

  onHide() {
    ble.stopScan();
    this.setData({ scanning: false });
  },

  onUnload() {
    if (this.removeDisconnectListener) this.removeDisconnectListener();
    protocol.close();
    ble.release().catch(() => {});
  },

  async scan() {
    this.setData({ devices: [], scanning: true, screenStatus: '' });
    try {
      await ble.scan(device => {
        if (!device.deviceId) return;
        const devices = this.data.devices.slice();
        const index = devices.findIndex(item => item.deviceId === device.deviceId);
        const merged = index >= 0 ? Object.assign({}, devices[index], device) : device;
        merged.displayName = displayName(merged);
        merged.isScreen = ble.isLikelyScreen(merged);
        if (index >= 0) devices[index] = merged;
        else devices.push(merged);
        devices.sort((a, b) => Number(b.isScreen) - Number(a.isScreen) || (b.RSSI || -999) - (a.RSSI || -999));
        this.setData({ devices });
      });
    } catch (error) {
      wx.showModal({ title: '蓝牙错误', content: error.errMsg || error.message || String(error), showCancel: false });
      this.setData({ scanning: false });
    }
  },

  async connect(event) {
    if (this.data.connecting) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ connecting: true, screenStatus: '正在连接并核对固件…' });
    try {
      await ble.connect(id);
      const initialStatus = await protocol.start(status => {
        const labels = ['设备空闲', '已接收指令', '正在准备屏幕', '正在清屏', '正在刷新', '处理完成', '处理失败', '指令未执行'];
        this.setData({
          screenStatus: labels[status.state] || '设备状态 ' + status.state,
          firmwareVersion: status.firmwareVersion || ''
        });
      });
      modeState.set('off');
      const previousVersion = wx.getStorageSync('autoalbum_ota_previous_version');
      let screenStatus = '配套固件已确认，可以同步图片';
      if (previousVersion && initialStatus.firmwareVersion) {
        screenStatus = previousVersion === initialStatus.firmwareVersion
          ? `设备仍运行 ${previousVersion}；OTA 后请等待重启并重新烧录确认`
          : `固件已切换：${previousVersion} → ${initialStatus.firmwareVersion}`;
        wx.removeStorageSync('autoalbum_ota_previous_version');
      }
      this.setData({
        connected: true,
        deviceId: id,
        scanning: false,
        firmwareVersion: initialStatus.firmwareVersion || '',
        screenStatus
      });
    } catch (error) {
      await ble.disconnect().catch(() => {});
      wx.showModal({ title: '连接失败', content: error.errMsg || error.message || String(error), showCancel: false });
      this.setData({ connected: false, deviceId: '', screenStatus: '', firmwareVersion: '' });
    } finally {
      this.setData({ connecting: false });
    }
  },

  async disconnect() {
    protocol.close();
    await ble.release();
    modeState.set('off');
    this.setData({ connected: false, deviceId: '', screenStatus: '', firmwareVersion: '' });
  }
});
