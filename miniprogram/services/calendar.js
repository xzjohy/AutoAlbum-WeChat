const core = require('./calendar-core');
const ble = require('./ble');
const log = require('../utils/logger');
const KEY='autoalbum_calendar';
function request(url) {
  const domain=url.split('/')[2];
  const failure=raw=>{
    const detail=raw && (raw.errMsg || raw.message) || String(raw);
    const error=new Error(/url not in domain list|not in.*domain|合法域名|域名.*校验/i.test(detail)
      ? '请求域名未配置：'+domain+'。请在微信小程序后台“开发管理 → 开发设置 → 服务器域名”的 request 合法域名中添加 https://'+domain+'，再重新上传体验版。'
      : /timeout|超时/i.test(detail) ? '城市/天气服务请求超时，请检查网络后重试（'+domain+'）'
      : '城市/天气服务请求失败：'+detail+'（'+domain+'）');
    log.warn('CALENDAR',error.message);return error;
  };
  return new Promise((resolve,reject)=>wx.request({url,timeout:10000,
    success:r=>{
      if(r.statusCode!==200)return reject(failure(new Error('HTTP '+r.statusCode)));
      if(!r.data || typeof r.data!=='object' || r.data.error)return reject(failure(new Error(r.data && r.data.reason || '返回数据格式无效')));
      resolve(r.data);
    },fail:e=>reject(failure(e))}));
}
function settings() { return wx.getStorageSync(KEY)||{}; }
function savePlace(place) { wx.setStorageSync(KEY,Object.assign(settings(),{place})); }
async function search(city) { const name=String(city||'').trim();if(!name)throw new Error('请输入城市名称');const r=await request('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=5&language=zh'); if(!Array.isArray(r.results)||!r.results.length)throw new Error('没有找到城市，请尝试城市简称或英文名称');return r.results; }
async function latest() {
  const s=settings();let weather=null,error='';
  if(s.place)try{const p=s.place,r=await request('https://api.open-meteo.com/v1/forecast?latitude='+p.latitude+'&longitude='+p.longitude+'&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FShanghai');weather=r.current;if(!weather)throw new Error('天气返回缺少当前数据');}catch(e){error=e.message||e.errMsg||'天气获取失败';}
  const m=core.model(new Date(),weather,s.place&&s.place.name);return {model:m,error};
}
function remember(m) { const s=settings(),devices=s.devices||{};devices[ble.getDeviceId()]={signature:core.signature(m),date:m.date,calendar:true};wx.setStorageSync(KEY,Object.assign(s,{devices})); }
function forget() {const s=settings(),devices=s.devices||{};delete devices[ble.getDeviceId()];wx.setStorageSync(KEY,Object.assign(s,{devices}));}
async function check(status) {const s=settings(),last=(s.devices||{})[ble.getDeviceId()];if(!last||status.scene!==0||status.carouselRunning)return '';const r=await latest();if(r.error)return r.model.date!==last.date?'日历日期已更新，点击查看并手动同步':'日历天气检查失败，可稍后重试';return core.signature(r.model)!==last.signature?'日历信息有更新，点击查看并手动同步':'';}
module.exports={core,settings,savePlace,search,latest,remember,forget,check};
