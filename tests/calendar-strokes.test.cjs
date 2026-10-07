const assert=require('node:assert/strict');
const core=require('../miniprogram/services/calendar-core');
const rgba=new Uint8ClampedArray(400*300*4).fill(255);
// Antialiased glyph edges that a nearest-color threshold of 128 erased.
const samples=[[170,170,170,255],[255,170,170,255],[0,0,0,100],[255,0,0,100],[235,235,235,255],[255,235,235,255],[0,0,0,0]];
samples.forEach((p,i)=>rgba.set(p,i*4));
const frame=core.packPixels(rgba);
const expected=['black','red','black','red','white','white','white'];
expected.forEach((color,n)=>{
 const mask=128>>(n&7),offset=n>>3;
 assert.equal(!(frame.black[offset]&mask),color==='black');
 assert.equal(!!(frame.red[offset]&mask),color==='red');
 assert.deepEqual(Array.from(frame.pixels.slice(n*4,n*4+4)),color==='black'?[0,0,0,255]:color==='red'?[255,0,0,255]:[255,255,255,255]);
});
assert.equal(frame.black.length+frame.red.length,30000);
const date=core.model(new Date(2026,9,7));
assert.notEqual(core.signature(date),JSON.stringify([date.date,date.place,date.weather,date.temperature,date.humidity]));
console.log('PASS calendar: light gray/red strokes, transparent glyph coverage, white background, exact preview planes and old-image revision');
