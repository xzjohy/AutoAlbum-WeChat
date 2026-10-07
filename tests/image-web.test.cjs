const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.CALENDAR_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(process.env.IMAGE_WEB_PATH||path.resolve(__dirname,'../../eink-gpt-clock-ui-v2/web_tools/index.html')).href);
  const result=await page.evaluate(async()=>{
   const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
   const frame=ctx.createImageData(400,300);frame.data.fill(255);frame.data.set([170,170,170,255,255,170,170,255],0);ctx.putImageData(frame,0,0);
   const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const mode=document.getElementById('dithering').value;convert_dithering();
   const preview=Array.from(ctx.getImageData(0,0,2,1).data);
   const album=await albumCanvas(new File([png],'strokes.png',{type:'image/png'}));
   const albumPreview=Array.from(album.getContext('2d').getImageData(0,0,2,1).data);
   const packets=[];rxTxSendCommand=async()=>({scene:0});sendCommand=async p=>{packets.push(Array.from(p));return {scene:0};};
   await upload_image();
   return {mode,preview,albumPreview,black:packets.find(p=>p[0]===3&&p[1]===255)?.[4],red:packets.find(p=>p[0]===3&&p[1]===0)?.[4],refresh:packets.at(-1)};
  });
  assert.equal(result.mode,'bwr_strokes');assert.deepEqual(result.preview,[0,0,0,255,255,0,0,255]);assert.deepEqual(result.albumPreview,result.preview);
  assert.equal(result.black&128,0);assert(result.red&64);assert.deepEqual(result.refresh,[1,1]);assert.deepEqual(errors,[]);
  console.log('PASS web image: default stroke preservation, native preview, decoded album PNG and actual upload packets');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
