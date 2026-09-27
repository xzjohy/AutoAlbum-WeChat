const protocol=require('./protocol');
const log=require('../utils/logger');

function checkSlot(slot){
  if(!Number.isInteger(slot)||slot<0||slot>3)throw new Error('Flash Slot 必须为 0~3');
}
async function saveSlot(slot){
  checkSlot(slot);log.info('FLASH',`save slot ${slot}`);
  return protocol.command(0x09,[slot],20000);
}
async function deleteSlot(slot){
  checkSlot(slot);log.info('FLASH',`delete slot ${slot}`);
  return protocol.command(0x0a,[slot],20000);
}
async function setCarousel(enabled,interval){
  const minutes=Math.max(1,Math.min(1440,parseInt(interval,10)||1));
  log.info('FLASH',`carousel ${enabled?'on':'off'} interval=${minutes}m`);
  return protocol.command(0x0b,[enabled?1:0,minutes&255,(minutes>>8)&255],10000);
}
async function resetScreen(){
  log.info('EPD','force reset requested');
  return protocol.emergencyReset();
}
module.exports={saveSlot,deleteSlot,setCarousel,resetScreen};
