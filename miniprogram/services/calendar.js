const core = require('./calendar-core');
const ble = require('./ble');
const KEY='autoalbum_calendar';
function request(url) { return new Promise((resolve,reject)=>wx.request({url,timeout:10000,success:r=>r.statusCode===200?resolve(r.data):reject(new Error('天气服务返回 '+r.statusCode)),fail:reject})); }
function settings() { return wx.getStorageSync(KEY)||{}; }
function savePlace(place) { wx.setStorageSync(KEY,Object.assign(settings(),{place})); }
async function search(city) { const r=await request('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(city)+'&count=5&language=zh'); if(!r.results||!r.results.length)throw new Error('没有找到城市，请尝试英文城市名');return r.results; }
async function latest() {
  const s=settings();let weather=null,error='';
  if(s.place)try{const p=s.place,r=await request('https://api.open-meteo.com/v1/forecast?latitude='+p.latitude+'&longitude='+p.longitude+'&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FShanghai');weather=r.current;if(!weather)throw new Error('天气返回缺少当前数据');}catch(e){error=e.message||e.errMsg||'天气获取失败';}
  const m=core.model(new Date(),weather,s.place&&s.place.name);return {model:m,error};
}
function remember(m) { const s=settings(),devices=s.devices||{};devices[ble.getDeviceId()]={signature:core.signature(m),date:m.date,calendar:true};wx.setStorageSync(KEY,Object.assign(s,{devices})); }
function forget() {const s=settings(),devices=s.devices||{};delete devices[ble.getDeviceId()];wx.setStorageSync(KEY,Object.assign(s,{devices}));}
async function check(status) {const s=settings(),last=(s.devices||{})[ble.getDeviceId()];if(!last||status.scene!==0||status.carouselRunning)return '';const r=await latest();if(r.error)return r.model.date!==last.date?'日历日期已更新，点击查看并手动同步':'日历天气检查失败，可稍后重试';return core.signature(r.model)!==last.signature?'日历信息有更新，点击查看并手动同步':'';}
module.exports={core,settings,savePlace,search,latest,remember,forget,check};
