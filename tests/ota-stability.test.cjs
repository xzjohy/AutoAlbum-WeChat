const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../miniprogram/services/ota.js'),'utf8');
async function scenario(mode){
 let connected=true,notifies=[],disconnects=[],packets=[],cancelled=false;
 const ble={isConnected:()=>connected,getRawWriteSize:()=>244,
 findCharacteristic:async()=>({characteristicId:'ota',properties:{write:true}}),enableNotifications:async()=>{},
 onCharacteristicValue:(id,f)=>{notifies.push(f);return()=>notifies=notifies.filter(x=>x!==f);},
 onDisconnect:f=>{disconnects.push(f);return()=>disconnects=disconnects.filter(x=>x!==f);},
 disconnect:async()=>{connected=false;disconnects.slice().forEach(f=>f());},
 writeCharacteristic:async(t,p)=>{
 packets.push(Array.from(p));
 if(mode==='busy'&&p[0]===1)notifies.slice().forEach(f=>f(Uint8Array.from([0xe0,1]).buffer));
 if(mode==='cancel'&&p[0]===3&&!cancelled){cancelled=true;await service.cancel();}
 if(mode==='disconnect'&&p[0]===6)await ble.disconnect();
 if(p[0]===6&&connected)notifies.slice().forEach(f=>f(Uint8Array.from([7,expected>>8,expected&255]).buffer));
 if(p[0]===7)await ble.disconnect();
 }};
 const ctx={module:{exports:{}},Uint8Array,ArrayBuffer,Error,Promise,Math,
 setTimeout:(f,ms)=>setTimeout(f,ms<=60?0:ms),clearTimeout,
 require:name=>name.includes('config')?{otaServiceUUID:'s',otaCharacteristicUUID:'c'}:
 name==='./ble'?ble:name==='./protocol'?{close(){}}:{info(){}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);const service=ctx.module.exports;
 const firmware=new Uint8Array(300);firmware.set([75,78,76,84],8);const expected=service.checksum(firmware);
 const progress=[];const result=service.update(firmware.buffer,s=>progress.push(s));
 if(mode==='success')await result;
 else await assert.rejects(result,mode==='busy'?/正在刷新/:mode==='cancel'?/取消/:/断开/);
 assert(!service.isRunning());assert(!notifies.length&&!disconnects.length);
 assert(packets.every(p=>p.length<=20));
 assert.equal(packets.some(p=>p[0]===7),mode==='success');
 if(mode==='success')assert.equal(progress.at(-1).progress,100);
}
(async()=>{for(const mode of ['success','busy','cancel','disconnect'])await scenario(mode);
 console.log('PASS mini OTA: default-MTU chunks, busy rejection, cancel, checksum disconnect, install reboot, listener cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
