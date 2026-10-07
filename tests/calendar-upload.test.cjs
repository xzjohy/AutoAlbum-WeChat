const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const core=require('../miniprogram/services/calendar-core');
const pixels=new Uint8ClampedArray(400*300*4).fill(255);
pixels.set([100,100,100,255],0);pixels.set([255,80,80,255],4);
let planes=core.packPixels(pixels);
assert.equal(planes.black.length+planes.red.length,30000);
assert.equal(planes.black[0]&128,0);assert(planes.red[0]&64);
assert.equal(core.packPixels(pixels,400,300,true).red.some(x=>x!==0),false);
assert.throws(()=>core.packPixels(pixels,800,600),/400/);
assert([...planes.pixels].every(x=>x===0||x===255));
// Thin glyph edges must survive; near-white background must remain white.
const edges=new Uint8ClampedArray(400*300*4).fill(255);
edges.set([170,170,170,255],0);edges.set([255,170,170,255],4);edges.set([235,235,235,255],8);
const sharp=core.packPixels(edges);assert.equal(sharp.black[0]&128,0);assert(sharp.red[0]&64);
assert(sharp.black[0]&32);assert.equal(sharp.red[0]&32,0);

const source=fs.readFileSync(path.join(__dirname,'../miniprogram/services/sync.js'),'utf8');
async function transfer(fail=false,native=true){
 const commands=[];let conversions=0;
 const protocol={isReady:()=>true,getStatus:()=>({firmwareVersion:'2.4.22'}),
  command:async(channel,p)=>{commands.push(Array.from(p));if(fail&&p[0]===1)throw new Error('屏幕 BUSY 超时');return {scene:0};}};
 const deps={'./ble':{isConnected:()=>true,getImageChunkSize:()=>12},'./protocol':protocol,
  './image':{convert:async()=>{conversions++;return planes;}},
  '../utils/logger':{info(){}},'./mode':{set(){}},'../config/ble':{screen:{width:400,height:300}}};
 const ctx={module:{exports:{}},Uint8Array,ArrayBuffer,Number,Math,Error,require:n=>deps[n]};
 vm.runInNewContext(source,ctx);const sync=ctx.module.exports;
 const work=sync.start([native?{planes}:{path:'photo.png'}],()=>{},{monochrome:false});
 if(fail)await assert.rejects(work,/BUSY/);else await work;
 assert.equal(conversions,native?0:1);assert.deepEqual(commands.at(-1),[1,1]);
 assert(!commands.some(c=>c[0]===11));
 for(const layer of [255,0])assert.equal(commands.filter(c=>c[0]===3&&c[1]===layer).reduce((n,c)=>n+c.length-4,0),15000);
}
(async()=>{await transfer();await transfer(true);await transfer(false,false);console.log('PASS calendar: 400x300 sharp pixels, red/BW, direct planes, full refresh, timeout propagated');})().catch(e=>{console.error(e);process.exitCode=1;});
