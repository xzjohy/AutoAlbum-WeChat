const calendar=require('../../services/calendar');
const ble=require('../../services/ble');
const sync=require('../../services/sync');
Page({
 data:{city:'',places:[],busy:false,uploading:false,progress:0,status:'请选择天气城市，生成日历后手动同步',preview:'',weatherError:''},
 onLoad(){const p=calendar.settings().place;this.setData({city:p?p.name:''});},
 onReady(){this.generate();},
 onUnload(){if(this.uploading){this.cancelled=true;sync.cancel();ble.release().catch(()=>{});}},
 inputCity(e){this.setData({city:e.detail.value});},
 async searchCity(){if(this.data.busy)return;this.setData({busy:true});try{this.setData({places:await calendar.search(this.data.city)});}catch(e){wx.showToast({title:e.message||'城市查询失败',icon:'none'});}finally{this.setData({busy:false});}},
 choosePlace(e){calendar.savePlace(this.data.places[Number(e.currentTarget.dataset.index)]);this.setData({places:[]});this.generate();},
 async generate(){if(this.data.busy)return;this.setData({busy:true,status:'正在生成日历…'});try{const r=await calendar.latest();this.model=r.model;await new Promise((resolve,reject)=>this.createSelectorQuery().select('#calendar-canvas').fields({node:true}).exec(async result=>{try{if(!result[0])throw new Error('画布未就绪');const canvas=result[0].node;canvas.width=400;canvas.height=300;calendar.core.draw(canvas.getContext('2d'),r.model);const path=await new Promise((res,rej)=>wx.canvasToTempFilePath({canvas,fileType:'png',destWidth:400,destHeight:300,success:res,fail:rej}));this.setData({preview:path.tempFilePath,weatherError:r.error,status:r.error?'天气不可用，日历仍可预览':'日历已生成，点击同步后更新墨水屏'});resolve();}catch(e){reject(e);}}));}catch(e){this.setData({status:e.message||'日历生成失败'});}finally{this.setData({busy:false});}},
 async upload(){if(this.data.busy||!this.data.preview)return;if(!ble.isConnected())return wx.showToast({title:'请先连接设备',icon:'none'});if(calendar.core.dateKey(new Date())!==this.model.date)return wx.showToast({title:'日期已变化，请重新生成日历',icon:'none'});this.uploading=true;this.cancelled=false;this.setData({busy:true,uploading:true,progress:0});try{if(sync.supportsStoredCarousel())await sync.stopStoredCarousel();if(this.cancelled)throw new Error("已取消上传");await sync.start([{path:this.data.preview}],s=>this.setData({progress:Math.round(s.overall*100),status:s.stage}),{monochrome:false});if(!this.cancelled){calendar.remember(this.model);this.setData({status:'日历同步完成',progress:100});}}catch(e){this.setData({status:this.cancelled?'已取消，请重新连接设备':e.message||'同步失败'});}finally{this.uploading=false;this.setData({busy:false,uploading:false});}},
 async cancel(){if(!this.uploading)return;this.cancelled=true;sync.cancel();await ble.release().catch(()=>{});},
 preview(){if(this.data.preview)wx.previewImage({urls:[this.data.preview]});}
});
