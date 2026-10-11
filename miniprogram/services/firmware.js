// Firmware major 3 is reserved for ebook readers. Unknown/future families
// must not inherit reader support merely because their version is newer.
function isEbook(status) {
  const version = typeof status === 'string' ? status : status && status.firmwareVersion;
  return typeof version === 'string' && /^3\.\d+\.\d+$/.test(version);
}
function ebookHint(connected, status) {
  if (!connected) return '请先连接设备，读取固件版本后开放电子书';
  if (!status || !status.firmwareVersion) return '尚未识别固件版本，电子书暂不可用';
  return isEbook(status) ? '3.X.X 电子书固件，已开放阅读功能' : `当前 ${status.firmwareVersion}，电子书需要 3.X.X 系列固件`;
}
function requireEbook(connected, status) {
  if (!connected || !isEbook(status)) throw new Error(ebookHint(connected, status));
}
module.exports = { isEbook, ebookHint, requireEbook };
