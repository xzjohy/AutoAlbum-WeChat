const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.CALENDAR_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(process.env.WEB_CALENDAR_PATH||path.resolve(__dirname,'../../eink-gpt-clock-ui-v2/web_tools/index.html')).href);
  await page.waitForFunction(()=>typeof calendarModel!=='undefined'&&calendarModel);
  assert.equal(await page.locator('#calendar-preview').getAttribute('width'),'400');
  assert(await page.locator('button:has-text("同步日历到墨水屏")').isDisabled());
  const pixels=await page.evaluate(()=>{const p=document.getElementById('calendar-preview').getContext('2d').getImageData(0,0,400,300).data;let red=0,black=0;for(let i=0;i<p.length;i+=4){if(p[i]>200&&p[i+1]<50)red++;if(p[i]<50&&p[i+1]<50)black++;}return {red,black};});
  assert(pixels.red>100&&pixels.black>100);
  await page.route('https://api.open-meteo.com/**',r=>r.abort());
  await page.evaluate(async()=>{calendarPlace={name:'上海',latitude:31,longitude:121};await generateCalendar();});
  assert.match(await page.locator('#calendar-status').innerText(),/天气获取失败/);
  assert.deepEqual(errors,[]);
  console.log('PASS web calendar: page load, preview colors, disconnected upload guard and weather failure');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
