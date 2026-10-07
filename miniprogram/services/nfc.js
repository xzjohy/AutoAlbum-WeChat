const protocol = require('./protocol');

function supported() { return !!((protocol.getStatus() || {}).capabilities & 0x80); }
function ensure() {
  if (!supported()) throw new Error('当前固件不支持 NFC 调试，请升级到 2.4.14 或更高版本');
}

function utf8(text) { return new Uint8Array(Array.from(unescape(encodeURIComponent(text))).map(c => c.charCodeAt(0))); }
function textTlv(text) {
  const value = utf8(String(text || ''));
  const payload = new Uint8Array(3 + value.length);
  payload.set([2, 0x65, 0x6e]); payload.set(value, 3);
  return tlv(new Uint8Array([0xd1, 1, payload.length, 0x54, ...payload]));
}
function urlTlv(url) {
  const value = utf8(String(url || ''));
  return tlv(new Uint8Array([0xd1, 1, value.length + 1, 0x55, 0, ...value]));
}
function tlv(ndef) {
  if (ndef.length > 157) throw new Error('NDEF 内容超过 157 字节');
  const raw = new Uint8Array(ndef.length + 3);
  raw.set([3, ndef.length]); raw.set(ndef, 2); raw[raw.length - 1] = 0xfe;
  const padded = new Uint8Array(Math.ceil(raw.length / 4) * 4); padded.set(raw);
  return padded;
}
function hex(bytes) { return Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join(' ').toUpperCase(); }
function decode(bytes) {
  const start = bytes.indexOf(3);
  if (start < 0 || start + 2 > bytes.length) return { type: '未知', text: '', hex: hex(bytes) };
  const length = bytes[start + 1]; const message = bytes.slice(start + 2, start + 2 + length);
  if (message.length < 4) return { type: '空', text: '', hex: hex(bytes) };
  const type = message[3]; const payload = message.slice(4);
  try {
    if (type === 0x54 && payload.length >= 3) return { type: '文本', text: decodeURIComponent(escape(String.fromCharCode(...payload.slice(3)))), hex: hex(message) };
    if (type === 0x55 && payload.length >= 1) return { type: 'URL', text: decodeURIComponent(escape(String.fromCharCode(...payload.slice(1)))), hex: hex(message) };
  } catch (_) {}
  return { type: '原始 NDEF', text: '', hex: hex(message) };
}
async function collect(command) {
  ensure();
  const data = new Uint8Array(160); let length = 0;
  const remove = protocol.onNfcReport(report => {
    data.set(report.data, report.offset);
    length = Math.max(length, report.offset + report.data.length);
  });
  try { await protocol.command(1, new Uint8Array(command)); return data.slice(0, length); }
  finally { remove(); }
}
async function read() { return decode(await collect([0xe9])); }
async function diagnostic() { return hex(await collect([0xe9, 1])); }
async function powerTest() { ensure(); return protocol.command(1, new Uint8Array([0xe9, 3])); }
async function writeText(text) { const data = textTlv(text); ensure(); return protocol.command(1, new Uint8Array([0xea, data.length, ...data])); }
async function writeUrl(url) { const data = urlTlv(url); ensure(); return protocol.command(1, new Uint8Array([0xea, data.length, ...data])); }
module.exports = { read, diagnostic, powerTest, writeText, writeUrl, cancel: () => protocol.cancelNfc() };
