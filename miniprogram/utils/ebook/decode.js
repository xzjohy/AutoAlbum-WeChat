function decode(buffer,encoding){
  const a=new Uint8Array(buffer),out=[];
  const bad=()=>{throw Error('文本编码不匹配，请选择正确的 UTF-8、GBK 或 UTF-16LE 编码');};
  if(encoding==='gbk'){
    const map=require('./gbk-table');
    for(let i=0;i<a.length;i++){
      const b=a[i];if(b<128){out.push(String.fromCharCode(b));continue;}if(b===128){out.push('€');continue;}
      const trail=a[++i];if(b<129||b>254||trail===undefined||trail<64||trail>254||trail===127)bad();
      const ch=map[(b-129)*190+trail-64-(trail>127?1:0)];if(!ch||ch==='\u0000')bad();out.push(ch);
    }
  }else if(encoding==='utf16le'){
    if(a.length%2)bad();
    for(let i=0;i<a.length;i+=2){let ch=a[i]|a[i+1]<<8;if(ch>=0xd800&&ch<=0xdbff){if(i+3>=a.length)bad();const low=a[i+2]|a[i+3]<<8;if(low<0xdc00||low>0xdfff)bad();out.push(String.fromCharCode(ch,low));i+=2;}else{if(ch>=0xdc00&&ch<=0xdfff)bad();out.push(String.fromCharCode(ch));}}
  }else{
    for(let i=0;i<a.length;){let b=a[i++],code,count,min;if(b<128){out.push(String.fromCharCode(b));continue;}
      if(b>=0xc2&&b<=0xdf){code=b&31;count=1;min=128;}else if(b>=0xe0&&b<=0xef){code=b&15;count=2;min=2048;}else if(b>=0xf0&&b<=0xf4){code=b&7;count=3;min=65536;}else bad();
      if(i+count>a.length)bad();for(let j=0;j<count;j++){b=a[i++];if((b&0xc0)!==0x80)bad();code=code*64+(b&63);}
      if(code<min||code>0x10ffff||(code>=0xd800&&code<=0xdfff))bad();out.push(String.fromCodePoint(code));
    }
  }
  return out.join('').replace(/^\uFEFF/,'');
}
module.exports={decode};
