const assert=require('node:assert/strict');
const core=require('../miniprogram/services/calendar-core');
const {packPlanes}=require('../miniprogram/services/image');
const sample=core.model(new Date(2024,10,5),{weather_code:0,temperature_2m:18,relative_humidity_2m:45},'上海');
assert.equal(sample.weekday,'星期二');
assert.equal(sample.cells.find(c=>c.day===5).lunar,'初五');
assert.equal(sample.cells[0].slot,5);
assert.equal(sample.cells.length,30);
assert.equal(core.model(new Date(2024,1,29)).cells.length,29);
assert.equal(core.model(new Date(2026,1,1)).cells.length,28);
assert.equal(core.model(new Date(2026,7,1)).cells.at(-1).slot,36);
assert.notEqual(core.signature(sample),core.signature({...sample,temperature:19}));
assert.equal(core.model(new Date(2026,9,7)).temperature,'--');
const rgba=new Uint8ClampedArray(400*300*4).fill(255);rgba.set([255,0,0,255],0);rgba.set([0,0,0,255],4);
const packed=packPlanes(rgba,400,300);assert.equal(packed.black.length,15000);assert.equal(packed.red.length,15000);
assert.ok(packed.red[0]&128);assert.equal(packed.black[0]&64,0);
// Fractional positions blur small glyphs before three-color quantization.
// Cover both five-row and six-row calendars without changing typography.
for(const month of [9,7]) {
 const text=[],bars=[];
 const ctx={fillRect:(...args)=>bars.push(args),fillText(...args){text.push({args,font:this.font});},beginPath(){},arc(){},stroke(){}};
 core.draw(ctx,core.model(new Date(2026,month,7)));
 assert(text.every(t=>Number.isInteger(t.args[1])&&Number.isInteger(t.args[2])));
 assert(text.every(t=>t.args[1]>=0&&t.args[1]<=400&&t.args[2]>=0&&t.args[2]<300));
 assert.equal(bars.slice(1).reduce((sum,b)=>sum+b[2],0),400);
 assert(bars.every(b=>b.every(Number.isInteger)));
 assert(text.some(t=>t.font==='12px sans-serif')); // Original lunar font size.
}
console.log('PASS: calendar lunar dates, leap months, six-row layout, weather signatures and 30KB three-color image');
