const ble=require('./ble');
const log=require('../utils/logger');

let token=1;
let waiter=null;
ble.setNotifyHandler(handleNotify);

function bytes(values){return new Uint8Array(values).buffer}
function nextToken(){token=(token%0xffff)+1;return token}
function crc16(data){
  let crc=0xffff;
  for(let i=0;i<data.length;i++){
    crc^=data[i]<<8;
    for(let b=0;b<8;b++)crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);
    crc&=0xffff;
  }
  return crc;
}
function handleNotify(data){
  if(data.length===12&&data[0]===0xe5&&data[1]===1){
    const t=data[2]|(data[3]<<8),state=data[4],reason=data[5];
    log.info('BLE',`status token=${t} state=${state} reason=${reason}`);
    if(waiter&&waiter.token===t&&(state===5||state===6||state===7)){
      const w=waiter;waiter=null;clearTimeout(w.timer);
      if(state===7)w.reject(new Error(`设备命令失败 reason=0x${reason.toString(16)}`));
      else w.resolve({state,reason});
    }
  }else if(data.length===2){
    log.info('BLE',`ack length=${(data[0]<<8)|data[1]}`);
  }
}
function waitStatus(t,timeout=10000){
  if(waiter)throw new Error('已有控制命令等待设备响应');
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(waiter&&waiter.token===t)waiter=null;reject(new Error('等待设备状态超时'))},timeout);
    waiter={token:t,resolve,reject,timer};
  });
}
async function command(cmd,args=[],timeout=10000){
  const t=nextToken();
  const packet=new Uint8Array(5+args.length);
  packet[0]=0x06;packet[1]=t&255;packet[2]=t>>8;packet[3]=0;packet[4]=cmd;packet.set(args,5);
  const done=waitStatus(t,timeout);
  try{await ble.write(packet.buffer)}catch(e){if(waiter&&waiter.token===t){clearTimeout(waiter.timer);waiter=null}throw e}
  return done;
}
async function begin(){
  await ble.write(bytes([0x00,0x00]));
}
async function sendPlane(plane,data,onProgress){
  const maxPayload=176;
  for(let off=0;off<data.length;off+=maxPayload){
    const n=Math.min(maxPayload,data.length-off);
    const packet=new Uint8Array(4+n);
    packet[0]=0x03;packet[1]=plane;packet[2]=(off>>8)&255;packet[3]=off&255;
    packet.set(data.subarray(off,off+n),4);
    await ble.write(packet.buffer);
    if(onProgress)onProgress((off+n)/data.length);
  }
}
async function uploadFramebuffer(black,red,onProgress){
  if(black.length!==15000||red.length!==15000)throw new Error('framebuffer 必须为 BLACK/RED 各 15000 bytes');
  await begin();
  await sendPlane(0xff,black,p=>onProgress&&onProgress(p*0.5));
  await sendPlane(0x00,red,p=>onProgress&&onProgress(0.5+p*0.5));
  const bc=crc16(black),rc=crc16(red);
  await command(0x08,[bc>>8,bc&255,rc>>8,rc&255],15000);
  if(onProgress)onProgress(1);
  return {blackCrc:bc,redCrc:rc};
}
module.exports={crc16,command,uploadFramebuffer};
