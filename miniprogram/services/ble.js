const cfg=require('../config/ble');
const log=require('../utils/logger');
let deviceId='';
let notifyHandler=null;

function p(fn,args={}){return new Promise((resolve,reject)=>fn({...args,success:resolve,fail:reject}))}
async function open(){
  try{await p(wx.openBluetoothAdapter)}
  catch(e){if(!(e&&e.errCode===10001))throw e}
  log.info('BLE','adapter opened');
}
async function scan(cb){
  await open();
  wx.onBluetoothDeviceFound(r=>(r.devices||[]).forEach(cb));
  await p(wx.startBluetoothDevicesDiscovery,{allowDuplicatesKey:false});
  log.info('BLE','scan started');
}
async function stopScan(){try{await p(wx.stopBluetoothDevicesDiscovery)}catch(e){}}
async function connect(id){
  await stopScan();
  await open();
  await p(wx.createBLEConnection,{deviceId:id});
  deviceId=id;
  wx.onBLECharacteristicValueChange(r=>{
    if(r.deviceId===deviceId&&r.characteristicId.toUpperCase()===cfg.notifyUUID.toUpperCase()&&notifyHandler)
      notifyHandler(new Uint8Array(r.value));
  });
  await p(wx.notifyBLECharacteristicValueChange,{
    deviceId,serviceId:cfg.serviceUUID,characteristicId:cfg.notifyUUID,state:true
  });
  log.info('BLE','connected '+id);
}
async function disconnect(){
  if(!deviceId)return;
  const id=deviceId;
  deviceId='';
  notifyHandler=null;
  await p(wx.closeBLEConnection,{deviceId:id});
  log.info('BLE','disconnected '+id);
}
async function write(buffer){
  if(!deviceId)throw new Error('BLE device not connected');
  return p(wx.writeBLECharacteristicValue,{
    deviceId,serviceId:cfg.serviceUUID,characteristicId:cfg.writeUUID,
    value:buffer,writeType:cfg.writeType
  });
}
function setNotifyHandler(fn){notifyHandler=fn}
module.exports={scan,stopScan,connect,disconnect,write,setNotifyHandler,isConnected:()=>!!deviceId,getDeviceId:()=>deviceId};
