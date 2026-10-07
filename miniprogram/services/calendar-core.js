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
  // Older saved images may have lost light glyph strokes. Prompt a manual
  // regeneration once, even if date and weather have not changed.
  function signature(m) { return JSON.stringify([m.date,m.place,m.weather,m.temperature,m.humidity,'stroke-preserve-184-v1']); }
  function draw(ctx,m) {
    ctx.fillStyle='#fff';ctx.fillRect(0,0,400,300); ctx.fillStyle='#000';ctx.textAlign='left';
    ctx.font='bold 25px sans-serif';ctx.fillText(m.year+'年'+m.month+'月'+m.day+'日',10,31);
    ctx.font='14px sans-serif';ctx.fillText(m.weekday,10,53);ctx.fillText(m.lunar,70,53);
    ctx.textAlign='right';ctx.font='15px sans-serif';ctx.fillText(m.weather,390,20);ctx.font='13px sans-serif';ctx.fillText(m.temperature+'°C | '+m.humidity+'%',390,40);ctx.fillText(m.place.slice(0,9),390,57);
    // Snap grid boundaries and glyph positions to native screen pixels.
    // Preserve the original fonts and sizes; no resize or stroke dilation.
    const edge=col=>Math.round(col*400/7),center=col=>Math.round((edge(col)+edge(col+1))/2);
    for(let col=0;col<7;col++){ctx.fillStyle=(col===0||col===6)?'#f00':'#000';ctx.fillRect(edge(col),66,edge(col+1)-edge(col),23);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='15px sans-serif';ctx.fillText(['日','一','二','三','四','五','六'][col],center(col),83);}
    const rows=Math.ceil((m.cells[0].slot+m.cells.length)/7), height=205/rows;
    m.cells.forEach(cell=>{const col=cell.slot%7,row=Math.floor(cell.slot/7),x=center(col),y=90+Math.round(row*height);
      ctx.fillStyle=(col===0||col===6)?'#f00':'#000';ctx.textAlign='center';ctx.font='bold 21px sans-serif';ctx.fillText(String(cell.day),x,y+23);
      ctx.font='12px sans-serif';ctx.fillText(cell.lunar,x,y+38);
      if(cell.day===m.day){ctx.strokeStyle='#f00';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y+16,16,0,Math.PI*2);ctx.stroke();}
    });
  }
  // Text is quantized without error diffusion: one solid pixel stays one solid pixel.
  function packPixels(rgba,width=400,height=300,monochrome=false) {
    if(width!==400||height!==300||!rgba||rgba.length!==width*height*4)throw new Error('日历必须为400×300像素');
    const black=new Uint8Array(15000),red=new Uint8Array(15000),pixels=new Uint8ClampedArray(rgba.length);black.fill(255);
    for(let n=0;n<width*height;n++) {
      const i=n*4,alpha=rgba[i+3]/255,r=rgba[i]*alpha+255*(1-alpha),g=rgba[i+1]*alpha+255*(1-alpha),b=rgba[i+2]*alpha+255*(1-alpha);
      // Nearest-colour quantization discarded glyph pixels lighter than 128.
      // Keep antialiased strokes with ~28% ink coverage without diffusing dots.
      const isRed=!monochrome && r>100 && r-g>40 && r-b>40 && Math.max(g,b)<184;
      const isBlack=!isRed && r*.299+g*.587+b*.114<184;
      const mask=128>>(n&7),offset=n>>3;
      if(isRed)red[offset]|=mask;else if(isBlack)black[offset]&=~mask;
      pixels[i]=isRed||!isBlack?255:0;pixels[i+1]=pixels[i+2]=isRed||isBlack?0:255;pixels[i+3]=255;
    }
    return {black,red,pixels};
  }
  return {model,draw,packPixels,signature,dateKey,weatherLabel};
});
