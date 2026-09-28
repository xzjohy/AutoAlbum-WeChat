const logger = require('./utils/logger');
const ble = require('./services/ble');
const protocol = require('./services/protocol');
const onlineClock = require('./services/online-clock');

async function releaseBluetooth(reason) {
  protocol.close();
  try {
    await ble.release();
    logger.info('APP', `蓝牙连接已释放：${reason}`);
  } catch (error) {
    logger.warn('APP', `释放蓝牙连接失败：${error.errMsg || error.message || error}`);
  }
}

App({
  onLaunch() {
    logger.info('APP', '自动相册启动');
    onlineClock.start();
  },
  onShow() {
    onlineClock.start();
  },
  onHide() {
    // Keep the link while switching tabs, but release it when the app is backgrounded.
    onlineClock.stop();
    releaseBluetooth('小程序进入后台');
  }
});
