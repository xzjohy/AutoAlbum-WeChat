const ble = require('../../services/ble');
const control = require('../../services/control');
const modeState = require('../../services/mode');
const onlineClock = require('../../services/online-clock');
const protocol = require('../../services/protocol');

function pad(value) { return String(value).padStart(2, '0'); }

function currentFields() {
  const now = new Date();
  return {
    dateText: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    timeText: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  };
}

function previewTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  const now = new Date();
  return match ? { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) } : {
    hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds()
  };
}

function previewCalendar(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return { text: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, weekday: days[date.getDay()] };
}

Page({
  data: {
    connected: false,
    clockModeActive: false,
    busy: false,
    status: '等待操作',
    rawCommand: 'E102',
    channels: ['图片数据', '模式 / 校时'],
    channel: 1,
    channelLabel: '模式 / 校时',
    dateText: '',
    timeText: '',
    clockFace: 'digital',
    refreshIntervalDraft: '5',
    refreshIntervalMinutes: 5,
    onlineSyncEnabled: false,
    onlineSyncDraft: '5',
    onlineSyncMinutes: 5,
    operationSeconds: 0,
    operationDetail: '',
    tempOffsetDraft: '0.0'
  },

  onLoad() {
    this.removeOperationListener = protocol.onOperation(event => {
      if (event.type === 'waiting') {
        this.setData({ operationDetail: '设备正在完成上一项操作，当前指令已排队等待' });
      } else if (event.type === 'status' && event.status) {
        const labels = ['', '已接收', '正在准备屏幕', '正在清屏', '正在刷新'];
        this.setData({
          operationSeconds: event.status.seconds || 0,
          operationDetail: event.busy ? `${labels[event.status.state] || '设备处理中'} · ${event.status.seconds || 0} 秒` : ''
        });
      } else if (event.type === 'idle') {
        this.setData({ operationDetail: '', operationSeconds: 0 });
      }
    });
  },

  onUnload() {
    if (this.removeOperationListener) this.removeOperationListener();
  },

  onReady() {
    this.drawClockPreview();
  },

  onShow() {
    const fields = this.data.dateText ? {} : currentFields();
    const online = onlineClock.settings();
    this.setData(Object.assign({
      connected: ble.isConnected(),
      clockModeActive: modeState.isClock(),
      onlineSyncEnabled: online.enabled,
      onlineSyncDraft: String(online.intervalMinutes),
      onlineSyncMinutes: online.intervalMinutes
    }, fields));
    const deviceStatus = protocol.getStatus();
    if (deviceStatus && deviceStatus.tempOffsetTenths != null) {
      this.setData({ tempOffsetDraft: (deviceStatus.tempOffsetTenths / 10).toFixed(1) });
    }
    this.drawClockPreview();
  },

  async run(label, action) {
    if (this.data.busy) return;
    this.setData({ busy: true, status: label });
    try {
      await action();
      this.setData({ status: label + '完成' });
      wx.showToast({ title: '操作完成' });
    } catch (error) {
      this.setData({ status: '操作失败' });
      wx.showModal({ title: '控制失败', content: error.message || error.errMsg || String(error), showCancel: false });
    } finally {
      this.setData({ busy: false, connected: ble.isConnected(), clockModeActive: modeState.isClock() });
    }
  },

  async toggleClockMode(event) {
    if (this.data.busy) return;
    const enableClock = event.detail.value;
    this.setData({ busy: true, status: enableClock ? '正在切换时钟模式' : '正在关闭时钟模式' });
    try {
      if (enableClock) await control.clockMode(this.data.clockFace, this.normalizeRefreshInterval());
      else await control.disableClockMode();
      this.setData({ clockModeActive: enableClock, status: enableClock ? '时钟模式已启用' : '时钟模式已关闭' });
      wx.showToast({ title: enableClock ? '时钟模式已启用' : '时钟模式已关闭' });
    } catch (error) {
      this.setData({ clockModeActive: modeState.isClock(), status: '模式切换失败' });
      wx.showModal({ title: '控制失败', content: error.message || error.errMsg || String(error), showCancel: false });
    } finally {
      this.setData({ busy: false, connected: ble.isConnected() });
    }
  },

  inputDate(event) {
    this.setData({ dateText: event.detail.value });
    this.drawClockPreview();
  },
  inputTime(event) {
    this.setData({ timeText: event.detail.value });
    this.drawClockPreview();
  },
  useCurrentTime() {
    this.setData(currentFields());
    this.drawClockPreview();
  },
  selectClockFace(event) {
    const clockFace = event.currentTarget.dataset.face;
    this.setData({ clockFace });
    this.drawClockPreview();
  },
  inputRefreshInterval(event) {
    this.setData({ refreshIntervalDraft: event.detail.value });
  },
  normalizeRefreshInterval() {
    const minutes = Math.max(1, Math.min(999, parseInt(this.data.refreshIntervalDraft, 10) || 5));
    this.setData({ refreshIntervalDraft: String(minutes), refreshIntervalMinutes: minutes });
    return minutes;
  },
  applyClockSettings() {
    const minutes = this.normalizeRefreshInterval();
    return this.run('正在更新时钟样式', () => control.setClockFace(this.data.clockFace, minutes));
  },

  async cancelCurrentOperation() {
    protocol.cancelWaiting();
    protocol.close();
    await ble.release().catch(() => {});
    this.setData({ busy: false, connected: false, operationDetail: '', status: '已取消等待并断开连接；屏幕会自行完成当前刷新' });
    wx.showToast({ title: '已安全断开', icon: 'none' });
  },

  inputTemperatureOffset(event) { this.setData({ tempOffsetDraft: event.detail.value }); },
  applyTemperatureOffset() {
    let degrees = Number(this.data.tempOffsetDraft);
    if (!Number.isFinite(degrees)) degrees = 0;
    degrees = Math.max(-12, Math.min(12, Math.round(degrees * 10) / 10));
    this.setData({ tempOffsetDraft: degrees.toFixed(1) });
    return this.run('正在保存温度校准', () => control.setTemperatureOffset(Math.round(degrees * 10)));
  },
  inputOnlineSyncInterval(event) {
    this.setData({ onlineSyncDraft: event.detail.value });
  },
  normalizeOnlineSyncInterval() {
    const minutes = Math.max(1, Math.min(999, parseInt(this.data.onlineSyncDraft, 10) || 5));
    this.setData({ onlineSyncDraft: String(minutes), onlineSyncMinutes: minutes });
    return minutes;
  },
  toggleOnlineSync(event) {
    const enabled = event.detail.value;
    const intervalMinutes = this.normalizeOnlineSyncInterval();
    const saved = onlineClock.configure({ enabled, intervalMinutes });
    this.setData({ onlineSyncEnabled: saved.enabled, onlineSyncDraft: String(saved.intervalMinutes), onlineSyncMinutes: saved.intervalMinutes });
    wx.showToast({ title: saved.enabled ? '在线校时已开启' : '在线校时已关闭', icon: 'none' });
  },
  applyOnlineSync() {
    const saved = onlineClock.configure({ enabled: this.data.onlineSyncEnabled, intervalMinutes: this.normalizeOnlineSyncInterval() });
    this.setData({ onlineSyncDraft: String(saved.intervalMinutes), onlineSyncMinutes: saved.intervalMinutes });
    wx.showToast({ title: `已设为每 ${saved.intervalMinutes} 分钟`, icon: 'none' });
  },
  drawClockPreview() {
    const time = previewTime(this.data.timeText);
    const calendar = previewCalendar(this.data.dateText);
    this.createSelectorQuery().select('#clock-preview').fields({ node: true, size: true }).exec(result => {
      const item = result && result[0];
      if (!item || !item.node) return;
      const canvas = item.node;
      const width = item.width || 600;
      const height = item.height || 300;
      const dpr = wx.getSystemInfoSync().pixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#f6f1e5';
      ctx.fillRect(0, 0, width, height);
      const header = () => {
        ctx.strokeStyle = '#161a1d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(width * 0.06, height * 0.17); ctx.lineTo(width * 0.94, height * 0.17); ctx.stroke();
        ctx.font = '16px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#161a1d';
        ctx.fillText('S24 E-PAPER', width * 0.07, height * 0.105);
        ctx.fillStyle = this.data.connected ? '#161a1d' : '#a72424';
        ctx.beginPath(); ctx.arc(width * 0.91, height * 0.095, 7, 0, Math.PI * 2); ctx.fill();
      };
      const footer = () => {
        const lineY = height * 0.72;
        ctx.strokeStyle = '#161a1d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(width * 0.06, lineY); ctx.lineTo(width * 0.94, lineY); ctx.stroke();
        const firstRow = lineY + height * 0.11;
        const secondRow = lineY + height * 0.22;
        ctx.font = '18px sans-serif'; ctx.fillStyle = '#161a1d';
        ctx.textAlign = 'left'; ctx.fillText(calendar.text, width * 0.07, firstRow);
        ctx.fillText(calendar.weekday, width * 0.07, secondRow);
        ctx.textAlign = 'center'; ctx.fillStyle = '#a72424';
        ctx.fillText('REMEMBER TO', width / 2, firstRow);
        ctx.fillText('DRINK WATER', width / 2, secondRow);
        ctx.textAlign = 'right'; ctx.fillStyle = '#161a1d';
        ctx.fillText('24°C', width * 0.93, firstRow + height * 0.055);
      };
      header();
      if (this.data.clockFace === 'digital') {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#161a1d'; ctx.font = 'bold 68px sans-serif';
        ctx.fillText(`${pad(time.hour)}:${pad(time.minute)}`, width / 2, height * 0.49);
        ctx.font = '18px sans-serif';
        ctx.fillStyle = '#a72424';
        ctx.fillText(`:${pad(time.second)}  DIGITAL`, width / 2, height * 0.61);
        footer();
        return;
      }
      const radius = Math.min(width, height) * 0.24;
      const x = width / 2;
      const y = height * 0.44;
      ctx.strokeStyle = '#161a1d'; ctx.fillStyle = '#161a1d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6 - Math.PI / 2;
        if (i % 3 === 0) {
          ctx.beginPath();
          ctx.arc(x + Math.cos(angle) * radius * 0.85, y + Math.sin(angle) * radius * 0.85, 5, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const outer = radius * 0.94;
        const inner = radius * 0.79;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      const hand = (angle, length, lineWidth, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
      };
      hand((time.hour % 12 + time.minute / 60) * Math.PI / 6 - Math.PI / 2, radius * 0.5, 7, '#161a1d');
      hand((time.minute + time.second / 60) * Math.PI / 30 - Math.PI / 2, radius * 0.72, 5, '#161a1d');
      hand(time.second * Math.PI / 30 - Math.PI / 2, radius * 0.78, 2, '#a72424');
      ctx.fillStyle = '#a72424'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      footer();
    });
  },
  setDeviceTime() {
    return this.run('正在设置设备时间', () => control.setTime(this.data.dateText, this.data.timeText));
  },
  syncTime() {
    this.setData(currentFields());
    return this.run('正在同步当前时间', control.syncTime);
  },
  clearBlack() { return this.run('正在清屏全黑', () => control.clear(0)); },
  clearWhite() { return this.run('正在清屏全白', () => control.clear(255)); },
  fullRefresh() { return this.run('正在执行全刷', control.fullRefresh); },

  setRawCommand(event) { this.setData({ rawCommand: event.detail.value }); },
  setChannel(event) {
    const channel = Number(event.detail.value);
    this.setData({ channel, channelLabel: channel ? '模式 / 校时' : '图片数据' });
  },
  sendRaw() {
    return this.run('正在发送自定义指令', () => control.raw(this.data.channel, this.data.rawCommand));
  }
});
