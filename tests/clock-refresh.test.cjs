const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let receive;
let capabilities = 0x3f;
let refreshMode = 0;
const writes = [];
function reply(token = 0, command = 0) {
  const p = new Uint8Array(capabilities & 0x80 ? 42 : capabilities & 0x40 ? 38 : capabilities & 0x20 ? 37 : capabilities & 0x10 ? 26 : 25);
  p.set([0xe5, 2, token & 255, token >> 8, 5, 0, 2, 0, 0, 0, command, 1]);
  p.set([2, 2, capabilities & 0x10 ? 8 : 7], 16);
  p[22] = capabilities; p[23] = 1; p[24] = 86;
  if (p.length === 26) p[25] = refreshMode;
  if (p.length >= 37) {
    p[25] = refreshMode; p[26] = 1; p[36] = 1;
    new DataView(p.buffer).setUint32(28, 3721, true);
    new DataView(p.buffer).setUint32(32, 3661, true);
  }
  if(p.length>=38) p[37]=1;
  if(p.length>=42) {p[38]=1;p[39]=2;p[40]=87;p[41]=1;}
  receive(p.buffer);
}
const ble = {
  onValue(fn) { receive = fn; return () => {}; },
  onDisconnect() { return () => {}; },
  async write(packet) {
    writes.push(Array.from(packet));
    queueMicrotask(() => {
      if (packet[0] === 6) {
        if (packet[4] === 0xe3 && packet.length >= 10) refreshMode = packet[9];
        reply(packet[1] | packet[2] << 8, packet[4]);
      } else reply();
    });
  }
};
const log = { info() {}, warn() {}, error() {} };
function load(file, dependencies) {
  const module = { exports: {} };
  const context = { module, exports: module.exports, Uint8Array, ArrayBuffer, Date, Promise, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) { assert(name in dependencies, name); return dependencies[name]; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  return module.exports;
}
const protocol = load('miniprogram/services/protocol.js', { './ble': ble, '../utils/logger': log });
const control = load('miniprogram/services/control.js', {
  './protocol': protocol, '../utils/logger': log, './mode': { set() {} }
});
(async () => {
  try {
    await protocol.start();
    assert.equal(protocol.getStatus().clockRefreshMode, 'full');
    const diagnostic = await protocol.requestStatus();
    assert.equal(diagnostic.clockIntervalMinutes, 1);
    assert.equal(diagnostic.clockNow, 3721);
    assert.equal(diagnostic.clockLastRefresh, 3661);
    assert.equal(diagnostic.clockRuntimeFlags, 1);
    await control.setClockFace('analog', 5, false, 'partial');
    assert.deepEqual(writes.at(-1).slice(4), [0xe3, 1, 5, 0, 0, 1]);
    assert.equal(protocol.getStatus().clockRefreshMode, 'partial');
    await control.setClockFace('digital', 10, true, 'full');
    assert.deepEqual(writes.at(-1).slice(4), [0xe3, 0, 10, 0, 1, 0]);
    assert.equal(protocol.getStatus().clockRefreshMode, 'full');
    capabilities = 0x0f; reply();
    const count = writes.length;
    await assert.rejects(control.setClockFace('digital', 5, true, 'partial'), /2\.2\.8/);
    assert.equal(writes.length, count);
    await control.setClockFace('digital', 5, true, 'full');
    assert.deepEqual(writes.at(-1).slice(4), [0xe3, 0, 5, 0, 1]);
    capabilities = 0; reply();
    await control.setClockFace('digital', 5, true, 'full');
    assert.deepEqual(writes.at(-1).slice(4), [0xe3, 0, 5, 0]);
    capabilities=0x7f;reply();
    await control.applyClockDisplay('analog',5,true,'partial',-15);
    assert.deepEqual(writes.at(-1).slice(4),[0xe7,1,5,0,1,1,241,0]);
    assert.equal(protocol.getStatus().clockFace,'analog');
    await control.applyClockDisplay('digital',5,false,'full',0,'2026-10-06','12:34:56');
    assert.equal(writes.at(-1).length,21);assert.equal(writes.at(-1)[11],1);
    await assert.rejects(control.setNfcEnabled(true,87),/独立/);
    capabilities=0xff;reply();
    const nfc=protocol.getStatus();assert.equal(nfc.nfcState,2);assert.equal(nfc.nfcAddress,87);assert.equal(nfc.nfcEnabled,true);
    await control.setNfcEnabled(false,87);assert.deepEqual(writes.at(-1).slice(4),[0xe8,0,87]);
    await assert.rejects(control.setNfcEnabled(true,174),/7 位/);
    console.log('PASS: E3 compatibility, atomic E7/time/signed temperature, NFC E8 and E5 25/26/37/38/42-byte readback');
  } finally { protocol.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
