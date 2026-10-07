(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../vendor/lunar').Solar);
  else root.CalendarCore = factory(root.Solar);
})(typeof window === 'undefined' ? this : window, function(Solar) {
  function dateKey(date) { return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-'); }
  function weatherLabel(code) {
    if (code === 0) return '晴'; if (code <= 3) return '多云'; if (code <= 48) return '雾';
    if (code <= 67) return '雨'; if (code <= 77) return '雪'; if (code <= 82) return '阵雨'; if (code <= 86) return '阵雪'; return '雷雨';
  }
  function model(date, weather, place) {
    const year=date.getFullYear(), month=date.getMonth()+1, day=date.getDate();
    const days=new Date(year,month,0).getDate(), first=new Date(year,month-1,1).getDay();
    const lunar=Solar.fromYmd(year,month,day).getLunar();
    const cells=[];
    for(let n=1;n<=days;n++) { const l=Solar.fromYmd(year,month,n).getLunar(); cells.push({day:n,slot:first+n-1,lunar:l.getDay()===1 ? l.getMonthInChinese()+'月' : l.getDayInChinese()}); }
    const w=weather || {};
    return {year,month,day,date:dateKey(date),weekday:'星期'+['日','一','二','三','四','五','六'][date.getDay()],lunar:lunar.getYearInGanZhi()+'年 '+lunar.getMonthInChinese()+'月'+lunar.getDayInChinese(),cells,place:place||'',weather:w.weather_code == null ? '天气未获取' : weatherLabel(w.weather_code),temperature:w.temperature_2m == null ? '--' : Math.round(w.temperature_2m),humidity:w.relative_humidity_2m == null ? '--' : Math.round(w.relative_humidity_2m)};
  }
  function signature(m) { return JSON.stringify([m.date,m.place,m.weather,m.temperature,m.humidity]); }
  function draw(ctx,m) {
    ctx.fillStyle='#fff';ctx.fillRect(0,0,400,300); ctx.fillStyle='#000';ctx.textAlign='left';
    ctx.font='bold 25px sans-serif';ctx.fillText(m.year+'年'+m.month+'月'+m.day+'日',10,31);
    ctx.font='14px sans-serif';ctx.fillText(m.weekday,10,53);ctx.fillText(m.lunar,70,53);
    ctx.textAlign='right';ctx.font='15px sans-serif';ctx.fillText(m.weather,390,20);ctx.font='13px sans-serif';ctx.fillText(m.temperature+'°C | '+m.humidity+'%',390,40);ctx.fillText(m.place.slice(0,9),390,57);
    for(let col=0;col<7;col++){ctx.fillStyle=(col===0||col===6)?'#f00':'#000';ctx.fillRect(col*400/7,66,400/7,23);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='15px sans-serif';ctx.fillText(['日','一','二','三','四','五','六'][col],(col+.5)*400/7,83);}
    const rows=Math.ceil((m.cells[0].slot+m.cells.length)/7), height=205/rows;
    m.cells.forEach(cell=>{const col=cell.slot%7,row=Math.floor(cell.slot/7),x=(col+.5)*400/7,y=90+row*height;
      ctx.fillStyle=(col===0||col===6)?'#f00':'#000';ctx.textAlign='center';ctx.font='bold 21px sans-serif';ctx.fillText(String(cell.day),x,y+23);
      ctx.font='12px sans-serif';ctx.fillText(cell.lunar,x,y+38);
      if(cell.day===m.day){ctx.strokeStyle='#f00';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y+16,16,0,Math.PI*2);ctx.stroke();}
    });
  }
  return {model,draw,signature,dateKey,weatherLabel};
});
