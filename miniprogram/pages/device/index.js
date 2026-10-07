const ble = require('../../services/ble');
const protocol = require('../../services/protocol');
const modeState = require('../../services/mode');
const connectionPolicy = require('../../services/connection-policy');
const calendar = require('../../services/calendar');

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
    firmwareVersion: '',
    calendarNotice: '',
    idleDisconnectDraft: '5'
  },

  onLoad() {
    this.removeDisconnectListener = ble.onDisconnect(() => {
      modeState.set('off');
      this.setData({ connected: false, deviceId: '', connecting: false, screenStatus: '连接已断开', firmwareVersion: '', calendarNotice:'' });
    });
  },

  onShow() {
    const status = protocol.getStatus();
    const idleMinutes = connectionPolicy.get();
    this.setData({
      connected: ble.isConnected(),
      deviceId: ble.getDeviceId(),
      firmwareVersion: status && status.firmwareVersion || '',
      idleDisconnectDraft: String(idleMinutes)
    });
    this.checkCalendar(status);
  },

  openCalendar() { wx.navigateTo({url:'/pages/calendar/index'}); },
  async checkCalendar(status) {
    if (!status || !ble.isConnected()) return this.setData({calendarNotice:''});
    const id=ble.getDeviceId();
    const notice=await calendar.check(status).catch(()=> '日历更新检查失败，可手动进入日历页重试');
    if(id===ble.getDeviceId())this.setData({calendarNotice:notice});
  },

  inputIdleDisconnect(event) { this.setData({ idleDisconnectDraft: event.detail.value }); },
  async applyIdleDisconnect() {
    if (!this.data.connected || this.data.connecting) return;
    const minutes = connectionPolicy.normalize(this.data.idleDisconnectDraft);
    this.setData({ connecting: true, screenStatus: '正在设置蓝牙空闲断开策略…' });
    try {
      const applied = await connectionPolicy.apply(minutes);
      this.setData({
        idleDisconnectDraft: String(applied),
        screenStatus: applied ? `空闲 ${applied} 分钟后自动断开` : '已关闭自动断开'
      });
      wx.showToast({ title: '连接策略已应用', icon: 'none' });
    } catch (error) {
      const message = error.message || error.errMsg || String(error);
      const unsupported = /无效|未知|packet|指令/.test(message);
      this.setData({ screenStatus: unsupported ? '当前固件不支持该设置，升级后可用' : '连接策略设置失败' });
      wx.showModal({ title: unsupported ? '需要新版固件' : '设置失败', content: unsupported ? '自动断开策略需要支持 E4 指令的新版固件。' : message, showCancel: false });
    } finally {
      this.setData({ connecting: false });
    }
  },

  onHide() {
    ble.stopScan();
    this.setData({ scanning: false });
  },

  onUnload() {
    if (this.removeDisconnectListener) this.removeDisconnectListener();
    // Page destruction must not tear down the app-wide BLE session.
    protocol.setStatusListener(null);
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
        const next = {
          screenStatus: labels[status.state] || '设备状态 ' + status.state,
          firmwareVersion: status.firmwareVersion || ''
        };
        if (status.idleDisconnectMinutes != null && status.idleDisconnectMinutes >= 0) {
          next.idleDisconnectDraft = String(status.idleDisconnectMinutes);
        }
        this.setData(next);
      });
      if (initialStatus.idleDisconnectMinutes != null && initialStatus.idleDisconnectMinutes >= 0) {
        this.setData({ idleDisconnectDraft: String(initialStatus.idleDisconnectMinutes) });
      }
      modeState.set(initialStatus.scene === 2 ? 'clock' : (initialStatus.scene === 0 ? 'image' : 'off'));
      this.checkCalendar(initialStatus);
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
