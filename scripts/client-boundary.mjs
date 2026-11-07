import {auditClientUrls} from './client-url-audit.mjs';
/** No external documentation links in shipped vendor diagnostics; runtime API URLs are explicit. */
export function clientBoundary(){let output='dist';return {
 name:'sommni-client-boundary',enforce:'pre',
 configResolved(config){output=config.build.outDir;},
 transform(code,id){
  if(!id.includes('node_modules/'))return null;
  let next=code;
  if(id.includes('@supabase/')){
   next=next.replace(/https:\/\/github\.com\/[^\s"'`\)]+/g,'[Supabase SDK documentation]');
   // This SDK default is unused by our configured client; keep even fallback auth on our dedicated project.
   next=next.replaceAll('http://localhost:9999','https://mcmtasetompygfktzhpr.supabase.co/auth/v1');
  }
  if(id.includes('onnxruntime'))next=next.replaceAll('https://web.dev/cross-origin-isolation-guide/','[cross-origin isolation documentation]');
  return next===code?null:{code:next,map:null};
 },
 async closeBundle(){console.log('[client URL audit]',await auditClientUrls(output));},
};}
