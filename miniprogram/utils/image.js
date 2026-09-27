const cfg=require('../config/ble');
const W=cfg.screen.width,H=cfg.screen.height,PLANE_BYTES=W*H/8;

function loadImage(canvas,path){
  return new Promise((resolve,reject)=>{
    const img=canvas.createImage();
    img.onload=()=>resolve(img);img.onerror=reject;img.src=path;
  });
}
async function toFramebuffer(path){
  if(!wx.createOffscreenCanvas)throw new Error('当前微信版本不支持离屏 Canvas，请升级微信');
  const canvas=wx.createOffscreenCanvas({type:'2d',width:W,height:H});
  const ctx=canvas.getContext('2d');
  const img=await loadImage(canvas,path);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  const scale=Math.min(W/img.width,H/img.height);
  const dw=Math.round(img.width*scale),dh=Math.round(img.height*scale);
  ctx.drawImage(img,Math.floor((W-dw)/2),Math.floor((H-dh)/2),dw,dh);
  const rgba=ctx.getImageData(0,0,W,H).data;
  const black=new Uint8Array(PLANE_BYTES),red=new Uint8Array(PLANE_BYTES);
  black.fill(0xff);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=(y*W+x)*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
    const isRed=r>135&&r>g*1.35&&r>b*1.35;
    const lum=0.299*r+0.587*g+0.114*b;
    const isBlack=!isRed&&lum<128;
    if(isRed||isBlack){
      const bit=y*W+x,bi=bit>>3,mask=0x80>>(bit&7);
      if(isBlack)black[bi]&=~mask;
      if(isRed)red[bi]|=mask;
    }
  }
  return {black,red};
}
module.exports={toFramebuffer};
