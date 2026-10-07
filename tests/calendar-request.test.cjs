const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let mode='ok',calls=0,url='';const logs=[];
const wx={request:o=>{calls++;url=o.url;
 if(mode==='domain')return o.fail({errMsg:'request:fail url not in domain list'});
 if(mode==='timeout')return o.fail({errMsg:'request:fail timeout'});
 if(mode==='network')return o.fail({errMsg:'request:fail connection reset'});
 o.success({statusCode:mode==='http'?429:200,data:mode==='bad'?'<html>error</html>':mode==='empty'?{}:{results:[{id:1,name:'上海',latitude:31,longitude:121}]}});
}};
const box={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/calendar'),'utf8'),{module:box,wx,Promise,Error,encodeURIComponent,require:n=>n==='../utils/logger'?{warn:(tag,text)=>logs.push(text)}:{}});
(async()=>{const s=box.exports;
 await assert.rejects(s.search('  '),/请输入/);assert.equal(calls,0);
 assert.equal((await s.search(' 上海 '))[0].name,'上海');assert(url.includes('name='+encodeURIComponent('上海')+'&'));
 for(const [type,pattern] of [['domain',/request 合法域名.*https:\/\/geocoding-api.open-meteo.com/],['timeout',/超时/],['network',/connection reset/],['http',/HTTP 429/],['bad',/格式无效/],['empty',/没有找到/]]){mode=type;await assert.rejects(s.search('上海'),pattern);}
 assert(logs.some(x=>x.includes('url not in domain list'))===false);assert(logs.some(x=>x.includes('请求域名未配置')));
 console.log('PASS calendar city requests: input trim, domain restriction, timeout, network, HTTP and malformed responses');
})().catch(e=>{console.error(e);process.exitCode=1;});
