const cfg=require('../config/ble');
const W=cfg.screen.width,H=cfg.screen.height,PLANE_BYTES=W*H/8;
const DEFAULTS={mode:'floyd',redThreshold:135,blackThreshold:145,redRatio:1.35};

function loadImage(canvas,path){
  return new Promise((resolve,reject)=>{
    const img=canvas.createImage();
    img.onload=()=>resolve(img);img.onerror=reject;img.src=path;
  });
}
function clamp(v){return v<0?0:(v>255?255:v)}
function isRedPixel(r,g,b,o){
  const maxGB=Math.max(g,b),sat=r-Math.min(g,b);
  return r>=o.redThreshold&&r>=maxGB*o.redRatio&&sat>=35;
}
function pack(classes){
  const black=new Uint8Array(PLANE_BYTES),red=new Uint8Array(PLANE_BYTES);
  black.fill(0xff);
  for(let i=0;i<classes.length;i++){
    const bi=i>>3,mask=0x80>>(i&7);
    if(classes[i]===1)black[bi]&=~mask;
    else if(classes[i]===2)red[bi]|=mask;
  }
  return {black,red};
}
function quantize(rgba,options){
  const o=Object.assign({},DEFAULTS,options||{});
  const classes=new Uint8Array(W*H);
  const lum=new Float32Array(W*H);
  for(let i=0;i<W*H;i++){
    const p=i*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
    if(isRedPixel(r,g,b,o)){classes[i]=2;lum[i]=255}
    else lum[i]=0.299*r+0.587*g+0.114*b;
  }
  if(o.mode==='threshold'){
    for(let i=0;i<classes.length;i++)if(classes[i]!==2)classes[i]=lum[i]<o.blackThreshold?1:0;
    return classes;
  }
  const atkinson=o.mode==='atkinson';
  for(let y=0;y<H;y++){
    const reverse=y&1;
    for(let step=0;step<W;step++){
      const x=reverse?W-1-step:step,i=y*W+x;
      if(classes[i]===2)continue;
      const old=clamp(lum[i]),out=old<o.blackThreshold?0:255,err=old-out;
      classes[i]=out===0?1:0;
      const spread=(dx,dy,w)=>{
        const nx=x+(reverse?-dx:dx),ny=y+dy;
        if(nx<0||nx>=W||ny<0||ny>=H)return;
        const ni=ny*W+nx;if(classes[ni]===2)return;
        lum[ni]+=err*w;
      };
      if(atkinson){
        spread(1,0,1/8);spread(2,0,1/8);spread(-1,1,1/8);
        spread(0,1,1/8);spread(1,1,1/8);spread(0,2,1/8);
      }else{
        spread(1,0,7/16);spread(-1,1,3/16);spread(0,1,5/16);spread(1,1,1/16);
      }
    }
  }
  return classes;
}
async function render(path,options){
  if(!wx.createOffscreenCanvas)throw new Error('当前微信版本不支持离屏 Canvas，请升级微信');
  const canvas=wx.createOffscreenCanvas({type:'2d',width:W,height:H}),ctx=canvas.getContext('2d');
  const img=await loadImage(canvas,path);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  const scale=Math.min(W/img.width,H/img.height),dw=Math.round(img.width*scale),dh=Math.round(img.height*scale);
  ctx.drawImage(img,Math.floor((W-dw)/2),Math.floor((H-dh)/2),dw,dh);
  const imageData=ctx.getImageData(0,0,W,H),classes=quantize(imageData.data,options);
  const out=ctx.createImageData(W,H);
  for(let i=0;i<classes.length;i++){
    const p=i*4,c=classes[i];
    out.data[p]=c===2?255:(c===1?0:255);
    out.data[p+1]=c===2?0:(c===1?0:255);
    out.data[p+2]=c===2?0:(c===1?0:255);out.data[p+3]=255;
  }
  ctx.putImageData(out,0,0);
  return {canvas,classes,...pack(classes)};
}
async function toFramebuffer(path,options){const r=await render(path,options);return {black:r.black,red:r.red}}
async function preview(path,options){
  const r=await render(path,options);
  if(typeof r.canvas.toDataURL==='function')return r.canvas.toDataURL('image/png');
  return path;
}
module.exports={toFramebuffer,preview,DEFAULTS};
