const ble=require('../../services/ble');

const STAGE_TEXT={
  idle:'搜索附近墨水屏',
  'stopping-scan':'正在停止扫描…',
  connecting:'正在建立蓝牙连接…',
  initializing:'蓝牙已连接，正在初始化通信…',
  ready:'设备已就绪'
};

Page({
  data:{devices:[],scanning:false,connecting:false,connected:false,ready:false,deviceId:'',connectionStage:'idle',connectionText:STAGE_TEXT.idle},
  onShow(){
    const connected=ble.isConnected(),ready=ble.isReady();
    this.setData({connected,ready,deviceId:ble.getDeviceId(),connectionStage:ready?'ready':'idle',connectionText:ready?STAGE_TEXT.ready:STAGE_TEXT.idle});
  },
  async scan(){
    if(this.data.connecting)return;
    this.setData({devices:[],scanning:true,connectionStage:'idle',connectionText:'正在扫描附近设备…'});
    try{
      await ble.scan(d=>{
        if(!this.data.devices.some(x=>x.deviceId===d.deviceId))this.setData({devices:this.data.devices.concat(d)});
      });
    }catch(e){
      wx.showModal({title:'蓝牙错误',content:e.errMsg||String(e),showCancel:false});
      this.setData({scanning:false,connectionText:STAGE_TEXT.idle});
    }
  },
  async connect(e){
    if(this.data.connecting)return;
    const id=e.currentTarget.dataset.id;
    this.setData({connecting:true,scanning:false,connectionStage:'connecting',connectionText:STAGE_TEXT.connecting});
    try{
      await ble.connect(id,stage=>this.setData({
        connectionStage:stage,
        connectionText:STAGE_TEXT[stage]||stage,
        connected:stage==='initializing'||stage==='ready',
        ready:stage==='ready',
        deviceId:stage==='initializing'||stage==='ready'?id:''
      }));
      this.setData({connecting:false,connected:true,ready:true,deviceId:ble.getDeviceId(),connectionStage:'ready',connectionText:STAGE_TEXT.ready});
    }catch(err){
      this.setData({connecting:false,connected:false,ready:false,deviceId:'',connectionStage:'idle',connectionText:STAGE_TEXT.idle});
      wx.showModal({title:'连接失败',content:err.errMsg||err.message||String(err),showCancel:false});
    }
  },
  async disconnect(){
    if(this.data.connecting)return;
    try{await ble.disconnect()}
    finally{this.setData({connected:false,ready:false,deviceId:'',connectionStage:'idle',connectionText:STAGE_TEXT.idle})}
  }
});
