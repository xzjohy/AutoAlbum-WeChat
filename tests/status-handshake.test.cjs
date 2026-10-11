const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function scenario(mode,version=[2,4,21]){
 let receive,disconnect,writes=0,id=0;const timers=new Map(),intervals=new Map();
 const packet=new Uint8Array(43);packet.set([0xe5,2,0,0,0,0,0,0,0,0,5,0]);packet.set(version,16);
 const ble={getRawWriteSize:()=>61,onValue:f=>{receive=f;return()=>{};},onDisconnect:f=>{disconnect=f;return()=>{};},write:async data=>{
  assert.deepEqual(Array.from(data),[5]);writes++;
  if(mode==='fatal')throw {errCode:10006,errMsg:'link lost'};
  if(mode==='transient'&&writes===1)throw {errCode:10008,errMsg:'system not ready'};
  if(mode==='immediate'||(['dropped','transient'].includes(mode)&&writes===2))receive(packet.buffer);
 }};
 const box={exports:{}};const clear=n=>{timers.delete(n);intervals.delete(n);};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/protocol'),'utf8'),{module:box,Uint8Array,Date,Math,Promise,Error,console,require:n=>n==='./ble'?ble:{info(){},warn(){}},setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:clear,setInterval:(f,ms)=>{intervals.set(++id,{f,ms});return id;},clearInterval:clear});
 return {service:box.exports,timers,intervals,disconnect:()=>disconnect(),writes:()=>writes,query:()=>{for(const t of Array.from(intervals.values()))if(t.ms===2500)t.f();}};
}
(async()=>{
 for(const mode of ['immediate','dropped','transient']){
  const s=scenario(mode),ready=s.service.start();await Promise.resolve();
  if(mode!=='immediate')s.query();
  const status=await ready;assert.equal(status.firmwareVersion,'2.4.21');assert(s.service.isReady());
  assert(!Array.from(s.intervals.values()).some(t=>t.ms===2500));s.service.close();assert.equal(s.intervals.size,0);assert.equal(s.timers.size,0);
 }
 const noReply=scenario('none'),failure=assert.rejects(noReply.service.start(),/MTU 64/);
 for(let n=0;n<8;n++)noReply.query();assert.equal(noReply.writes(),4);
 Array.from(noReply.timers.values()).find(t=>t.ms===12000).f();await failure;assert(!noReply.service.isReady());assert.equal(noReply.intervals.size,0);
 const lost=scenario('none'),disconnected=assert.rejects(lost.service.start(),/断开/);lost.disconnect();await disconnected;
 const fatal=scenario('fatal');await assert.rejects(fatal.service.start(),/link lost/);
 const reader=scenario('immediate',[3,99,42]);await reader.service.start();
 await assert.rejects(reader.service.command(0,[0,255]),/电子书/);
 await assert.rejects(reader.service.command(1,[0xe3,0,5,0]),/电子书/);
 assert.equal(reader.writes(),1);reader.service.close();
 console.log('PASS E5 handshake: first packet loss, transient write, four-query limit, timeout, disconnect and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
