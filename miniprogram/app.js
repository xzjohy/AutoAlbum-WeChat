const logger = require('./utils/logger');
const onlineClock = require('./services/online-clock');

App({
  onLaunch() {
    logger.info('APP', '自动相册启动');
    onlineClock.start();
  },
  onShow() {
    onlineClock.start();
  },
  onHide() {
    // Backgrounding pauses phone-driven clock sync but deliberately keeps BLE.
    // The firmware's configurable idle lease remains the disconnect authority.
    onlineClock.stop();
    logger.info('APP', '小程序进入后台，保留蓝牙连接');
  }
});
