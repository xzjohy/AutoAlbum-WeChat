const shared=require('./ble');
const protocol=require('./protocol');
const firmware=require('./firmware');
const ota=require('./ota');
const log=require('../utils/logger');
const SERVICE='13187B10-EBA9-A3BA-044E-83D3217D9A38';
const CHAR='4B646063-6264-F3A7-8941-E65356EA82FE';
const api=(name,args={})=>new Promise((resolve,reject)=>wx[name]({...args,success:resolve,fail:reject}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
class ReaderBLE {
  constructor(onState){
    this.onState=onState;this.seq=(Date.now()%60000)+1;this.listeners=new Set();this.lock=false;this.disposed=false;
    this.char=CHAR;this.service=SERVICE;this.deviceId=shared.getDeviceId();
    this.removeValue=shared.onValue(buffer=>{for(const fn of this.listeners)fn(new Uint8Array(buffer),CHAR);});
    this.removeDisconnect=shared.onDisconnect(()=>{for(const fn of this.listeners)fn(null);this.onState('连接已断开');});
  }
  get id(){return shared.getDeviceId();}
  async write(bytes){
    if(this.disposed)throw Error('电子书页面已关闭');
    if(shared.getDeviceId()!==this.deviceId)throw Error('连接设备已改变，请重新进入电子书页面');
    firmware.requireEbook(shared.isConnected() && protocol.isReady(),protocol.getStatus());
    if(ota.isRunning())throw Error('固件升级中，请稍后再操作电子书');
    await shared.write(Uint8Array.from(bytes));
  }
  async exchange(bytes,match,timeout=10000,service=this.service,char=this.char){
    let timer,fn;const response=new Promise((resolve,reject)=>{fn=(p,c)=>{if(!p){reject(Error('蓝牙已断开'));return;}if(c===char.toUpperCase()&&match(p))resolve(p);};this.listeners.add(fn);timer=setTimeout(()=>reject(Error('设备响应超时')),timeout);});
    // Attach rejection handling before the native write can take a long time.
    const write=this.write(bytes,service,char);try{return (await Promise.all([response,write]))[0];}finally{clearTimeout(timer);this.listeners.delete(fn);}
  }
  async command(op,payload=[]){
    if(this.lock)throw Error('请等待当前指令完成');this.lock=true;
    const seq=this.seq=(this.seq%65535)+1,packet=[0x70,op,seq&255,seq>>8,...payload];
    try{let response;
      for(let retry=0;retry<3;retry++){try{response=await this.exchange(packet,p=>p.length===20&&p[0]===0x71&&p[1]===op&&(p[2]|p[3]<<8)===seq);break;}catch(e){if(!this.id||retry===2)throw e;}}
      const errors=['','设备忙，请等待屏幕刷新完成','无效的数据或上传顺序','文件校验失败','页码不在设备已上传范围','输入校准失败','Flash 写入或容量检测失败'];
      if(response[4])throw Error(errors[response[4]]||'设备拒绝指令');
      const v=new DataView(response.buffer,response.byteOffset,response.byteLength);
      return {flags:response[5],value:v.getUint32(6,true),page:v.getUint32(10,true),total:v.getUint32(14,true),pages:v.getUint16(18,true)};
    }finally{this.lock=false;}
  }
  async upload(bytes,onProgress){
    log.info('EBOOK', `开始上传电子书 ${bytes.length} 字节`);
    const {crc32}=require('../utils/ebook/book');await this.command(1,[...u32(bytes.length),...u32(crc32(bytes))]);
    try{for(let at=0;at<bytes.length;at+=12){const part=bytes.slice(at,at+12),r=await this.command(2,[...u32(at),...part]);if(r.value!==at+part.length)throw Error('设备接收位置不一致');if(at%120===0)onProgress(Math.floor(r.value/bytes.length*100));}const r=await this.command(3);onProgress(100);log.info('EBOOK','电子书校验提交完成');return r;}catch(e){await this.command(6).catch(()=>{});log.warn('EBOOK',e.message||String(e));throw e;}
  }
  async displayFailure(r){
    if(r.flags&32){const d=await this.command(10),reason=d.value&255;return '屏幕刷新失败：'+({3:'初始化失败',4:'BUSY 未在规定时间内结束',7:'未检测到 BUSY 启动'}[reason]||`错误码 ${reason}`)+'。书籍仍在设备中，可重试当前页。';}
    if(r.flags&16)return '阅读进度或光敏设置保存失败：Flash 写入校验未通过。可重试当前页。';
    return '旧固件报告刷新或保存失败，请升级至 3.0.2 获取具体原因。';
  }
  async waitDisplay(allowFailure=false){for(let i=0;i<40;i++){const r=await this.command(0);if(!(r.flags&2)){if((r.flags&8)&&!allowFailure)throw Error(await this.displayFailure(r));return r;}await sleep(1000);}throw Error('屏幕仍在刷新，请检查设备');}
  async destroy(){this.disposed=true;for(const fn of this.listeners)fn(null);this.removeValue();this.removeDisconnect();}

}
module.exports={ReaderBLE,api,u32,sleep};
