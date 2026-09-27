const cfg=require('../config/ble');
const log=require('../utils/logger');
let deviceId='',ready=false,notifyHandler=null,connecting=false,listenerInstalled=false;

function p(fn,args={}){return new Promise((resolve,reject)=>fn({...args,success:resolve,fail:reject}))}
function now(){return Date.now()}
function alreadyOpen(e){
  const msg=String(e&&e.errMsg||e&&e.message||'').toLowerCase();
  return !!(e&&(e.errCode===10001||msg.includes('already opened')||msg.includes('already open')));
}
async function open(){
  const t=now();
  try{await p(wx.openBluetoothAdapter)}
  catch(e){if(!alreadyOpen(e))throw e}
  log.info('BLE',`adapter ready ${now()-t}ms`);
}
async function scan(cb){
  await open();
  wx.onBluetoothDeviceFound(r=>(r.devices||[]).forEach(cb));
  await p(wx.startBluetoothDevicesDiscovery,{allowDuplicatesKey:false});
  log.info('BLE','scan started');
}
async function stopScan(){
  const t=now();
  try{await p(wx.stopBluetoothDevicesDiscovery)}
  catch(e){}
  log.info('BLE',`scan stopped ${now()-t}ms`);
}
function installListener(){
  if(listenerInstalled)return;
  wx.onBLECharacteristicValueChange(r=>{
    if(r.deviceId===deviceId&&r.characteristicId.toUpperCase()===cfg.notifyUUID.toUpperCase()&&notifyHandler)
      notifyHandler(new Uint8Array(r.value));
  });
  listenerInstalled=true;
}
async function connect(id,onStage){
  if(connecting)throw new Error('设备正在连接，请稍候');
  if(ready&&deviceId===id)return;
  connecting=true;ready=false;
  const total=now();
  try{
    onStage&&onStage('stopping-scan');
    await stopScan();

    onStage&&onStage('connecting');
    let t=now();
    await p(wx.createBLEConnection,{deviceId:id});
    deviceId=id;
    log.info('BLE',`link connected ${now()-t}ms`);

    installListener();
    onStage&&onStage('initializing');
    t=now();
    await p(wx.notifyBLECharacteristicValueChange,{
      deviceId:id,serviceId:cfg.serviceUUID,characteristicId:cfg.notifyUUID,state:true
    });
    log.info('BLE',`notify enabled ${now()-t}ms`);
    ready=true;
    onStage&&onStage('ready');
    log.info('BLE',`READY total=${now()-total}ms device=${id}`);
  }catch(e){
    ready=false;
    if(deviceId===id){
      try{await p(wx.closeBLEConnection,{deviceId:id})}catch(ignore){}
      deviceId='';
    }
    log.error('BLE',`connect failed after ${now()-total}ms: ${e.errMsg||e.message||e}`);
    throw e;
  }finally{connecting=false}
}
async function disconnect(){
  if(!deviceId)return;
  const id=deviceId;deviceId='';ready=false;connecting=false;
  try{await p(wx.closeBLEConnection,{deviceId:id})}
  finally{log.info('BLE','disconnected '+id)}
}
async function write(buffer){
  if(!deviceId||!ready)throw new Error('BLE device not ready');
  return p(wx.writeBLECharacteristicValue,{deviceId,serviceId:cfg.serviceUUID,characteristicId:cfg.writeUUID,value:buffer,writeType:cfg.writeType});
}
function setNotifyHandler(fn){notifyHandler=fn}
module.exports={
  scan,stopScan,connect,disconnect,write,setNotifyHandler,
  isConnected:()=>!!deviceId,isReady:()=>ready,isConnecting:()=>connecting,getDeviceId:()=>deviceId
};
