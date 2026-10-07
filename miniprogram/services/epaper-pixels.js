(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.EpaperPixels=factory();
})(typeof window==='undefined'?this:window,function(){
  function color(r,g,b,alpha=255,monochrome=false){
    const a=alpha/255;r=r*a+255*(1-a);g=g*a+255*(1-a);b=b*a+255*(1-a);
    if(r>100&&r-g>40&&r-b>40&&Math.max(g,b)<184)return monochrome?0:2;
    return r*.299+g*.587+b*.114<184?0:1;
  }
  return {color};
});
