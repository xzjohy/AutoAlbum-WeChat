const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const firmware=require('../miniprogram/services/firmware');
for(const version of ['3.0.0','3.1.9','3.255.255','3.99.123'])assert(firmware.isEbook({firmwareVersion:version}));
for(const version of ['',null,undefined,'2.4.23','4.0.0','13.0.0','3.0','3.0.0junk'])assert(!firmware.isEbook({firmwareVersion:version}));
assert.throws(()=>firmware.requireEbook(false,{firmwareVersion:'3.0.0'}),/连接/);
let connected=true,status={firmwareVersion:'3.7.42'},upgrading=false,writes=0,receiver,disconnect;
const shared={isConnected:()=>connected,getDeviceId:()=>connected?'device':'',onValue:fn=>{receiver=fn;return()=>{receiver=null;};},onDisconnect:fn=>{disconnect=fn;return()=>{disconnect=null;};},write:async bytes=>{
 writes++;assert(bytes.length<=20);const response=new Uint8Array(20);response.set([0x71,bytes[1],bytes[2],bytes[3]]);new DataView(response.buffer).setUint32(6,102400,true);queueMicrotask(()=>receiver(response.buffer));
}};
const protocol={isReady:()=>true,getStatus:()=>status};
const box={exports:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/ebook'),'utf8'),{module:box,require:n=>({'./ble':shared,'./protocol':protocol,'./firmware':firmware,'./ota':{isRunning:()=>upgrading}}[n]),Uint8Array,DataView,Set,Date,Math,Promise,Error,setTimeout,clearTimeout});
(async()=>{
 const reader=new box.exports.ReaderBLE(()=>{});assert.equal((await reader.command(0)).value,102400);assert.equal(writes,1);
 for(const v of ['2.4.23','4.0.0','']){status={firmwareVersion:v};await assert.rejects(()=>reader.command(0));assert.equal(writes,1);}
 status={firmwareVersion:'3.255.255'};upgrading=true;await assert.rejects(()=>reader.command(0),/升级/);assert.equal(writes,1);upgrading=false;
 connected=false;disconnect();await assert.rejects(()=>reader.command(0),/连接/);assert.equal(writes,1);connected=true;
 const actualCommand=reader.command;
 reader.command=async op=>({flags:40,value:4});
 await assert.rejects(()=>reader.waitDisplay(),/BUSY/);
 assert.equal((await reader.waitDisplay(true)).flags,40);
 reader.command=async op=>({flags:24,value:0});await assert.rejects(()=>reader.waitDisplay(),/Flash/);
 reader.command=async op=>({flags:8,value:0});await assert.rejects(()=>reader.waitDisplay(),/旧固件/);
 reader.command=actualCommand;
 await reader.destroy();assert(connected,'leaving ebook must preserve app-wide BLE connection');await assert.rejects(()=>reader.command(0),/关闭/);assert.equal(receiver,null);assert.equal(disconnect,null);
 const config=require('../miniprogram/app.json');assert.equal(config.tabBar.list.length,5);assert.deepEqual(config.tabBar.list.map(p=>p.text),['设备','图片','TXT','时钟','升级']);assert(config.tabBar.list.some(p=>p.pagePath==='pages/ebook/index'));assert(!config.tabBar.list.some(p=>p.pagePath==='pages/logs/index'));assert(config.pages.includes('pages/logs/index'));assert(config.pages.includes('pages/ebook/index'));assert(config.pages.includes('pages/calendar/index'));
 console.log('PASS ebook: all 3.x, old/unknown/4.x denied, command guard after device change, OTA lock, shared BLE lifecycle, existing navigation preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
