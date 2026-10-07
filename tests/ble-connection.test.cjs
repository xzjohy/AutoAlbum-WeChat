const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../miniprogram/services/ble.js'),'utf8');
let attempts=0,closed=0,stateListener,requestedMTU;
const ok=o=>o.success({});
const wx={openBluetoothAdapter:ok,stopBluetoothDevicesDiscovery:ok,
 onBluetoothDeviceFound(){},onBLECharacteristicValueChange(){},onBLEConnectionStateChange:f=>stateListener=f,
 createBLEConnection:o=>{attempts++;attempts===1?o.fail({errCode:10003,errMsg:'BLE connection failed status 147'}):o.success({});},
 closeBLEConnection:o=>{closed++;stateListener({deviceId:o.deviceId,connected:false});o.success({});},
 setBLEMTU:o=>{requestedMTU=o.mtu;o.success({});},getBLEMTU:o=>o.success({mtu:requestedMTU||23}),
 getBLEDeviceServices:o=>o.success({services:[{uuid:'service'}]}),
 getBLEDeviceCharacteristics:o=>o.success({characteristics:[{uuid:'char',properties:{write:true,notify:true}}]}),
 notifyBLECharacteristicValueChange:ok};
const ctx={wx,module:{exports:{}},Promise,Error,Uint8Array,ArrayBuffer,setTimeout:f=>setTimeout(f,0),
 require:n=>n.includes('config')?{serviceUUID:'service',characteristicUUID:'char',writeType:'write',preferredMTU:247}:{info(){},warn(){}}};
vm.createContext(ctx);vm.runInContext(source,ctx);const ble=ctx.module.exports;
(async()=>{
 await ble.connect('screen');assert.equal(attempts,2);assert.equal(closed,1);assert(ble.isConnected());assert.equal(requestedMTU,64);assert.equal(ble.getRawWriteSize(),61);
 await ble.disconnect();assert(!ble.isConnected());
 wx.setBLEMTU=o=>o.fail({errMsg:'not supported'});wx.getBLEMTU=o=>o.success({mtu:23});
 await ble.connect('screen');assert(ble.isConnected());assert.equal(ble.getRawWriteSize(),20);await ble.disconnect();
 const policyCtx={module:{exports:{}},wx:{getStorageSync:()=>0},require:()=>({})};
 vm.createContext(policyCtx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../miniprogram/services/connection-policy.js'),'utf8'),policyCtx);
 assert.equal(policyCtx.module.exports.get(),0);
 console.log('PASS mini BLE: bounded retry, status MTU64, unsupported-MTU fallback, disconnect and explicit zero idle policy');
})().catch(e=>{console.error(e);process.exitCode=1;});
