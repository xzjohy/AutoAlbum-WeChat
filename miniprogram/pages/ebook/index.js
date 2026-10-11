const book=require('../../utils/ebook/book');
const {ReaderBLE,api,u32,sleep}=require('../../services/ebook');
const shared=require('../../services/ble');
const protocol=require('../../services/protocol');
const firmware=require('../../services/firmware');
Page({
  data:{connection:'尚未连接',connected:false,devices:[],busy:false,status:'选择 TXT 后，按设备尺寸分页，再选择需要携带的页码范围。',percent:0,encodings:['UTF-8','GBK','UTF-16LE'],encodingIndex:0,fonts:[16,20,24],fontIndex:1,families:['黑体 / sans-serif','宋体 / serif'],familyIndex:0,filename:'',pageCount:0,characters:0,start:1,end:1,size:0,capacity:book.CAPACITY,oversize:false,jump:'',devicePage:0,deviceTotal:0,devicePages:0,leds:['蓝灯 · 共阳极实验','绿灯 · 共阳极实验','蓝灯 · 共阴极实验','绿灯 · 共阴极实验'],ledIndex:0,sensorText:''},
  onLoad(){
    this.ble=new ReaderBLE(()=>this.refreshAccess());
    this.removeStatus=protocol.onStatus(()=>this.refreshAccess());
    this.refreshAccess();
  },
  onShow(){if(!this.data.busy && this.ble.deviceId!==shared.getDeviceId()){this.ble.destroy();this.ble=new ReaderBLE(()=>this.refreshAccess());}this.refreshAccess();if(this.data.connected)this.task(async()=>{const r=await this.ble.command(0);this.setData({capacity:r.value});this.updateDevice(r);this.updateRange();});},
  refreshAccess(){const status=protocol.getStatus();const allowed=shared.isConnected()&&protocol.isReady()&&firmware.isEbook(status);this.setData({connected:allowed,firmwareVersion:status&&status.firmwareVersion||'',connection:allowed?'已连接电子书固件':firmware.ebookHint(shared.isConnected(),status),...(!allowed?{devicePage:0,deviceTotal:0,devicePages:0}:{})});},
  onUnload(){if(this.removeStatus)this.removeStatus();this.ble.destroy();},
  async task(fn){if(this.data.busy)return;this.setData({busy:true,percent:0});try{firmware.requireEbook(shared.isConnected()&&protocol.isReady(),protocol.getStatus());await fn();}catch(e){this.setData({status:e.message||e.errMsg||String(e)});}finally{this.setData({busy:false});}},
  openDevice(){wx.switchTab({url:'/pages/device/index'});},
  updateDevice(r){this.setData({devicePage:r.page,deviceTotal:r.total,devicePages:r.pages});},
  encodingChange(e){this.setData({encodingIndex:+e.detail.value});if(this.path)this.readFile();},
  choose(){this.task(async()=>{const r=await api('chooseMessageFile',{count:1,type:'file',extension:['txt']});const file=r.tempFiles[0];if(file.size>8*1024*1024)throw Error('请先将大于 8 MB 的 TXT 拆分，避免手机内存不足');this.path=file.path;this.setData({filename:file.name});await this.loadText();});},
  readFile(){this.task(()=>this.loadText());},
  async loadText(){this.book=this.selection=this.text=null;this.setData({pageCount:0,characters:0,size:0,oversize:true});const encoding=['utf8','gbk','utf16le'][this.data.encodingIndex];this.text=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:this.path,success:r=>{try{resolve(require('../../utils/ebook/decode').decode(r.data,encoding));}catch(e){reject(e);}},fail:reject}));if(this.text.includes('\ufffd'))throw Error('存在无法解码的字符，请更换文本编码后重试');this.repaginate();this.setData({status:'已完成分页。选择起止页即可拆分。'});},
  repaginate(){if(!this.text)return;this.book=book.paginate(this.text,this.data.fonts[this.data.fontIndex]);this.setData({pageCount:this.book.pages.length,characters:this.book.characters,start:1,end:1});this.updateRange();},
  fontChange(e){this.setData({fontIndex:+e.detail.value});try{this.repaginate();}catch(error){this.setData({status:error.message});}},
  familyChange(e){this.setData({familyIndex:+e.detail.value});},
  rangeChange(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});this.updateRange();},
  updateRange(){if(!this.book)return;try{this.selection=book.plan(this.book,Number(this.data.start),Number(this.data.end));this.setData({size:this.selection.size,oversize:this.selection.size>this.data.capacity});}catch(e){this.selection=null;this.setData({oversize:true,status:e.message});}},
  fit(){try{if(!this.book)return;let low=Number(this.data.start),high=this.book.pages.length,best=low-1;while(low<=high){const mid=Math.floor((low+high)/2);if(book.plan(this.book,Number(this.data.start),mid).size<=this.data.capacity){best=mid;low=mid+1;}else high=mid-1;}if(best<Number(this.data.start))throw Error('单页字库也超出容量，请缩小字号');this.setData({end:best});this.updateRange();}catch(e){this.setData({status:e.message});}},
  canvas(id){return new Promise((resolve,reject)=>this.createSelectorQuery().select('#'+id).fields({node:true,size:true}).exec(r=>r&&r[0]&&r[0].node?resolve(r[0].node):reject(Error('画布未就绪，请重试'))));},
  async rasterizer(){const canvas=await this.canvas('glyph');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');let count=0;return async(ch,font,w)=>{
    ctx.fillStyle='#fff';ctx.fillRect(0,0,32,32);ctx.fillStyle='#000';ctx.font=`${font}px ${this.data.familyIndex?'serif':'sans-serif'}`;ctx.textBaseline='alphabetic';ctx.fillText(ch,0,Math.floor(font*.85),w);
    const rgba=ctx.getImageData(0,0,font,font).data,stride=Math.ceil(font/8),a=new Uint8Array(stride*font);
    for(let y=0;y<font;y++)for(let x=0;x<w;x++){const i=(y*font+x)*4;if((rgba[i]+rgba[i+1]+rgba[i+2])<510)a[y*stride+(x>>3)]|=128>>(x&7);}
    if(++count%40===0)await sleep(0);return a;
  };},
  preview(){this.task(async()=>{if(!this.selection)throw Error('请选择有效范围');const p=book.plan(this.book,Number(this.data.start),Number(this.data.start)),raster=await this.rasterizer(),canvas=await this.canvas('preview');canvas.width=400;canvas.height=300;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,300);ctx.fillStyle='black';let x=12,y=12;const f=p.font,stride=Math.ceil(f/8);for(const ch of p.pages[0]){if(ch==='\n'){x=12;y+=f+4;continue;}const w=book.width(ch,f);if(x+w>388){x=12;y+=f+4;}const a=await raster(ch,f,w);for(let dy=0;dy<f;dy++)for(let dx=0;dx<w;dx++)if(a[dy*stride+(dx>>3)]&(128>>(dx&7)))ctx.fillRect(x+dx,y+dy,1,1);x+=w;}this.setData({status:`预览第 ${p.start} 页，使用与设备相同的点阵字模。`});});},
  exportPart(){this.task(async()=>{if(!this.selection)throw Error('请选择有效范围');const name=this.data.filename.replace(/\.txt$/i,'').replace(/[^\w\u4e00-\u9fff-]/g,'_');const path=`${wx.env.USER_DATA_PATH}/${name}_${this.data.start}-${this.data.end}.txt`;await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:this.selection.pages.join(''),encoding:'utf8',success:resolve,fail:reject}));this.setData({status:`已保存子文件：${path}`});if(wx.shareFileMessage)await api('shareFileMessage',{filePath:path,fileName:`${name}_${this.data.start}-${this.data.end}.txt`});});},
  upload(){this.task(async()=>{if(!this.selection)throw Error('请选择有效页码范围');await this.ble.waitDisplay(true);this.setData({status:'正在生成随书字库…'});const a=await book.pack(this.selection,await this.rasterizer(),this.data.capacity);this.setData({status:'正在上传，请保持小程序在前台…'});const r=await this.ble.upload(a,p=>this.setData({percent:p}));this.updateDevice(r);await sleep(100);this.updateDevice(await this.ble.waitDisplay());this.setData({status:'上传校验通过，设备已结束刷新。'});});},
  gesture(e){this.task(async()=>{await this.ble.waitDisplay(true);this.updateDevice(await this.ble.command(5,[Number(e.currentTarget.dataset.event)]));await sleep(100);this.updateDevice(await this.ble.waitDisplay());this.setData({status:'阅读指令已执行。'});});},
  jumpChange(e){this.setData({jump:e.detail.value});},
  jumpTo(){this.task(async()=>{const page=Number(this.data.jump);if(!Number.isInteger(page)||page<1||page>0xffffffff)throw Error('请输入有效页码');await this.ble.waitDisplay(true);this.updateDevice(await this.ble.command(4,u32(page)));await sleep(100);await this.ble.waitDisplay();this.setData({status:`已跳转至第 ${page} 页。`});});},
  ledChange(e){this.setData({ledIndex:+e.detail.value});},
  calibrate(){this.task(async()=>{await this.ble.waitDisplay(true);await this.ble.command(7,[this.data.ledIndex+1]);this.setData({status:'请保持 LED 无遮挡，正在采样…'});await sleep(2200);await this.readSensor();});},
  async readSensor(){const r=await this.ble.command(8),v=r.value>>>0,raw=v&1023,baseline=(v>>>10)&1023,state=v>>>20;
    const names=['关闭','无遮挡校准中','已启用','校准失败：未启用翻页'],time=n=>n>=500?'≥500 μs（采样超时）':`${n} μs`;
    this.setData({sensorText:`${names[state&3]} · 当前 ${time(raw)} / 基线 ${time(baseline)} · ${(state&3)===2?(state&4?'遮挡':'未遮挡'):'未判定遮挡'}`,status:(state&3)===3?'光敏校准未通过；可改变照明后重新读取，再进行无遮挡校准。':(state&3)===0?'光敏输入已关闭。':'光敏采样已读取。'});
  },
  refreshDiagnostic(){this.task(async()=>{
    const r=await this.ble.command(0);this.updateDevice(r);
    const version=(protocol.getStatus().firmwareVersion||'').split('.').map(Number);
    if(version[0]===3&&version[1]===0&&version[2]<2){this.setData({status:`设备页码 ${r.page}/${r.total} · ${r.flags&2?'等待或正在刷新':'当前无刷新'} · 请升级到 3.0.2 读取具体错误`});return;}
    const d=await this.ble.command(10),reason=d.value&255,save=(d.value>>>8)&255,stage=(d.value>>>16)&255;
    const phases=['空闲','已发刷新指令，等待 BUSY 启动','已检测到 BUSY，等待结束','BUSY 已释放，正在稳定确认'];
    const errors={3:'初始化失败（刷新指令尚未发出）',4:'刷新超时（已检测到 BUSY，但未稳定结束）',7:'未检测到 BUSY 启动',255:'未细分的刷新失败'};
    this.setData({status:`设备页码 ${r.page}/${r.total} · ${phases[stage]||'状态码 '+stage}${!stage&&(r.flags&2)?'，有待执行的刷新':''} · ${reason?(errors[reason]||'刷新错误码 '+reason):'无已记录的刷新错误'} · ${save?'Flash 保存失败':'无已记录的保存错误'}`});
  });},
  retryPage(){this.task(async()=>{const r=await this.ble.waitDisplay(true);if(!r.page)throw Error('设备尚无书籍');await this.ble.command(4,u32(r.page));this.updateDevice(await this.ble.waitDisplay());this.setData({status:'当前页刷新完成，请核对实屏。'});});},

  sensor(){this.task(()=>this.readSensor());},
  disableSensor(){this.task(async()=>{await this.ble.command(7,[0]);await this.readSensor();});},
  nfcStatus(){this.task(async()=>{const r=await this.ble.command(9),n=r.value;this.setData({status:`NFC ${n&255?'已启用':'未启用'}，状态码 ${(n>>>8)&255}，地址 0x${((n>>>16)&255).toString(16)}；原有 NFC 射频服务随设备运行。`});});},
  ota(){wx.switchTab({url:'/pages/ota/index'});}
});
