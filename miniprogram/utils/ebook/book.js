const CAPACITY=0x19000;
function crc32(a){let c=0xffffffff;for(const b of a){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function width(ch,f){return ch.codePointAt(0)<128?f/2:f;}
function paginate(text,font){
  if(![16,20,24].includes(font))throw Error('字号只支持 16 / 20 / 24');
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
  if(!text.trim())throw Error('TXT 文件没有可阅读内容');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('文件包含不支持的控制字符');
  const pages=[];let page=[],x=0,line=0;const lines=Math.floor(252/(font+4));
  const finish=()=>{pages.push(page.join(''));page=[];x=0;line=0;};
  for(const ch of text){
    if(ch==='\n'){page.push(ch);x=0;line++;if(line===lines)finish();continue;}
    const w=width(ch,font);
    if(x+w>376){line++;x=0;if(line===lines)finish();}
    page.push(ch);x+=w;
  }
  if(page.length)finish();
  return {pages,font,characters:Array.from(text).length};
}
function plan(book,start,end){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>book.pages.length)throw Error('请选择有效的起止页');
  const pages=book.pages.slice(start-1,end), glyphs=[], ids=new Map();let count=0;
  for(const page of pages)for(const ch of page){count++;if(ch!=='\n'&&!ids.has(ch)){ids.set(ch,glyphs.length);glyphs.push(ch);}}
  // A newline-only selection still has a valid blank glyph table.
  if(!glyphs.length){ids.set(' ',0);glyphs.push(' ');}
  const size=40+(pages.length+1)*4+count*2+glyphs.length*(1+book.font*Math.ceil(book.font/8));
  return {pages,glyphs,ids,count,size,start,total:book.pages.length,font:book.font};
}
async function pack(p,rasterize,capacity=CAPACITY){
  if(p.size>capacity)throw Error(`子文件 ${p.size} 字节超过设备上限 ${capacity} 字节，请减少页数`);
  if(p.glyphs.length>65534)throw Error('字库字符数量过多');
  const a=new Uint8Array(p.size),v=new DataView(a.buffer);
  v.setUint32(0,0x314b4245,true);v.setUint16(4,1,true);v.setUint16(6,p.font,true);v.setUint16(8,400,true);v.setUint16(10,300,true);
  [p.start,p.total,p.pages.length,p.glyphs.length,p.count,p.size,0].forEach((n,i)=>v.setUint32(12+i*4,n,true));
  let count=0,at=40+(p.pages.length+1)*4;
  p.pages.forEach((page,i)=>{v.setUint32(40+i*4,count,true);for(const ch of page){v.setUint16(at,ch==='\n'?65535:p.ids.get(ch),true);at+=2;count++;}});
  v.setUint32(40+p.pages.length*4,count,true);
  const stride=Math.ceil(p.font/8),bytes=stride*p.font;
  for(let i=0;i<p.glyphs.length;i++){
    const ch=p.glyphs[i],w=width(ch,p.font),bits=await rasterize(ch,p.font,w);
    if(bits.length!==bytes)throw Error('字模尺寸错误');
    a[at++]=w;a.set(bits,at);at+=bytes;
  }
  return a;
}
module.exports={CAPACITY,crc32,width,paginate,plan,pack};
