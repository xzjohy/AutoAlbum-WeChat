const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const core=require('../miniprogram/services/calendar-core');
const rgba=new Uint8ClampedArray(400*300*4).fill(255);rgba.set([255,0,0,255],0);
rgba.set([170,170,170,255],4);rgba.set([255,170,170,255],8);
let page,remembered=0,idle=false,fail=false,transfers=[];
const ctx={fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},stroke(){},getImageData(){return {data:new Uint8ClampedArray(rgba)};},putImageData(frame){assert([...frame.data].every(x=>x===0||x===255));}};
const canvas={getContext:()=>ctx};
const deps={'../../services/calendar':{core,latest:async()=>({model:core.model(new Date()),error:''}),remember(){remembered++;}},
 '../../services/ble':{isConnected:()=>true},'../../services/protocol':{waitForIdle:async()=>{idle=true;},getStatus:()=>({firmwareVersion:'2.4.22'})},
 '../../services/sync':{start:async(items,progress,options)=>{assert(idle);assert(!items[0].path);assert.equal(items[0].planes.black.length,15000);assert.equal(options.monochrome,false);assert(items[0].planes.red.some(x=>x));assert.equal(items[0].planes.black[0]&64,0);assert(items[0].planes.red[0]&32);transfers.push(items);if(fail)throw new Error('屏幕 BUSY 超时');},cancel(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/calendar/index.js'),'utf8'),{Page:p=>page=p,require:n=>deps[n],Date,Promise,Uint8Array,
 wx:{canvasToTempFilePath(o){assert.equal(o.width,400);assert.equal(o.height,300);assert.equal(o.destWidth,400);assert.equal(o.destHeight,300);o.success({tempFilePath:'calendar.png'});}}});
page.setData=patch=>Object.assign(page.data,patch);
page.createSelectorQuery=()=>({select(){return this;},fields(){return this;},exec(callback){callback([{node:canvas}]);}});
(async()=>{await page.generate();assert(page.planes);await page.upload();assert.equal(remembered,1);assert.equal(page.data.progress,100);
fail=true;await page.upload();assert.equal(remembered,1);assert.match(page.data.status,/BUSY/);assert(!page.data.busy);assert(!page.data.uploading);
console.log('PASS calendar page: native PNG preview, direct planes, three-color full, wait idle, BUSY failure never remembered');})().catch(e=>{console.error(e);process.exitCode=1;});
