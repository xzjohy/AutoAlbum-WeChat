const ble=require('./ble');
const protocol=require('./protocol');
const control=require('./control');
const image=require('../utils/image');
const log=require('../utils/logger');

async function start(slots,onProgress){
  if(!ble.isConnected())throw new Error('请先连接蓝牙设备');
  const selected=slots.filter(x=>x&&x.path);
  if(!selected.length)throw new Error('请至少选择一张图片');
  for(let i=0;i<selected.length;i++){
    const item=selected[i];
    const slot=item.slot;
    onProgress&&onProgress({index:i,total:selected.length,slot,stage:'convert',fileProgress:0});
    log.info('SYNC',`Slot ${slot}: convert 400x300 BWR`);
    const fb=await image.toFramebuffer(item.path);
    onProgress&&onProgress({index:i,total:selected.length,slot,stage:'upload',fileProgress:0});
    await protocol.uploadFramebuffer(fb.black,fb.red,p=>onProgress&&onProgress({
      index:i,total:selected.length,slot,stage:'upload',fileProgress:p
    }));
    onProgress&&onProgress({index:i,total:selected.length,slot,stage:'crc-ok',fileProgress:1});
    log.info('SYNC',`Slot ${slot}: CRC verified`);
    onProgress&&onProgress({index:i,total:selected.length,slot,stage:'saving',fileProgress:1});
    await control.saveSlot(slot);
    onProgress&&onProgress({index:i,total:selected.length,slot,stage:'saved',fileProgress:1});
    log.info('SYNC',`Slot ${slot}: saved`);
  }
  return selected.length;
}
async function display(item,onProgress){
  if(!ble.isConnected())throw new Error('请先连接蓝牙设备');
  if(!item||!item.path)throw new Error('请先选择图片');
  const fb=await image.toFramebuffer(item.path);
  await protocol.uploadFramebuffer(fb.black,fb.red,onProgress);
  await protocol.command(0x01,[1],90000);
}
module.exports={start,display};
