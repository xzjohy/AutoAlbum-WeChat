const ble=require('../../services/ble');
const syncer=require('../../services/sync');
const control=require('../../services/control');
const log=require('../../utils/logger');

function emptySlots(){return [0,1,2,3].map(slot=>({slot,path:'',size:0,status:'未选择'}))}
function intervalValue(v){return Math.max(1,Math.min(1440,parseInt(v,10)||1))}

Page({
  data:{
    slots:emptySlots(),connected:false,syncing:false,
    currentIndex:0,currentTotal:0,progress:0,stage:'',
    carouselEnabled:false,carouselInterval:5
  },
  onShow(){this.setData({connected:ble.isConnected()})},
  chooseSlot(e){
    if(this.data.syncing)return;
    const slot=Number(e.currentTarget.dataset.slot);
    wx.chooseMedia({
      count:1,mediaType:['image'],sourceType:['album','camera'],
      success:r=>{
        const f=r.tempFiles&&r.tempFiles[0];if(!f)return;
        const slots=this.data.slots.slice();
        slots[slot]={slot,path:f.tempFilePath,size:f.size||0,status:'待同步'};
        this.setData({slots});
        log.info('ALBUM',`Slot ${slot} selected`);
      }
    });
  },
  async deleteSlot(e){
    if(this.data.syncing)return;
    const slot=Number(e.currentTarget.dataset.slot);
    const slots=this.data.slots.slice();
    try{
      if(ble.isConnected()){
        wx.showLoading({title:'删除设备槽位'});
        await control.deleteSlot(slot);
      }
      slots[slot]={slot,path:'',size:0,status:ble.isConnected()?'设备已删除':'本地已清空'};
      this.setData({slots});
      log.info('ALBUM',`Slot ${slot} deleted`);
    }catch(err){
      log.error('ALBUM',`delete Slot ${slot} failed: ${err.message||err.errMsg||err}`);
      wx.showModal({title:'删除失败',content:err.message||err.errMsg||String(err),showCancel:false});
    }finally{wx.hideLoading()}
  },
  onCarouselChange(e){this.setData({carouselEnabled:e.detail.value})},
  onIntervalInput(e){this.setData({carouselInterval:e.detail.value})},
  onIntervalBlur(e){this.setData({carouselInterval:intervalValue(e.detail.value)})},
  async applyCarousel(){
    if(!ble.isConnected())return wx.showToast({title:'请先连接设备',icon:'none'});
    const minutes=intervalValue(this.data.carouselInterval);
    try{
      wx.showLoading({title:'写入轮播设置'});
      await control.setCarousel(this.data.carouselEnabled,minutes);
      this.setData({carouselInterval:minutes});
      wx.showToast({title:'设置已保存'});
    }catch(e){
      log.error('ALBUM','carousel failed: '+(e.message||e.errMsg||e));
      wx.showModal({title:'设置失败',content:e.message||e.errMsg||String(e),showCancel:false});
    }finally{wx.hideLoading()}
  },
  async sync(){
    const selected=this.data.slots.filter(x=>x.path);
    if(!selected.length)return wx.showToast({title:'请先选择图片',icon:'none'});
    this.setData({syncing:true,progress:0,stage:'准备同步',currentIndex:0,currentTotal:selected.length});
    try{
      await syncer.start(selected,p=>{
        const stageMap={convert:'转换三色图像',upload:'BLE 上传', 'crc-ok':'CRC 校验通过',saving:'写入 Flash',saved:'Flash 保存完成'};
        const slots=this.data.slots.slice();
        slots[p.slot]={...slots[p.slot],status:stageMap[p.stage]||p.stage};
        this.setData({
          slots,currentIndex:p.index+1,currentTotal:p.total,
          progress:Math.round((p.fileProgress||0)*100),
          stage:`Slot ${p.slot+1} · ${stageMap[p.stage]||p.stage}`
        });
      });
      const minutes=intervalValue(this.data.carouselInterval);
      await control.setCarousel(this.data.carouselEnabled,minutes);
      this.setData({stage:'全部同步完成',progress:100,carouselInterval:minutes});
      wx.showToast({title:'同步完成'});
    }catch(e){
      const msg=e.message||e.errMsg||String(e);
      log.error('SYNC',msg);this.setData({stage:'同步失败：'+msg});
      wx.showModal({title:'同步失败',content:msg,showCancel:false});
    }finally{this.setData({syncing:false})}
  }
});
