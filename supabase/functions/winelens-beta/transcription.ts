import { Fault } from '../winelens-research/domain.ts';
export function pcmWave(body:any):Uint8Array|null {
 if(body.sample_rate!==16000||typeof body.pcm!=='string'||body.pcm.length>341336||!body.pcm.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.pcm)||body.pcm.length%4)throw new Fault(400,'Expected up to eight seconds of 16 kHz mono PCM.');
 let raw:string;try{raw=atob(body.pcm);}catch{throw new Fault(400,'Invalid audio encoding.');}
 if(raw.length<3200||raw.length>256000||raw.length%2)throw new Fault(400,'Invalid audio length.');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),input=new DataView(bytes.buffer);let power=0;
 for(let i=0;i<bytes.length;i+=2)power+=(input.getInt16(i,true)/32768)**2;
 if(Math.sqrt(power/(bytes.length/2))<.008)return null;
 const wav=new Uint8Array(44+bytes.length),view=new DataView(wav.buffer),write=(at:number,text:string)=>{for(let i=0;i<text.length;i++)wav[at+i]=text.charCodeAt(i);};
 write(0,'RIFF');view.setUint32(4,36+bytes.length,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,bytes.length,true);wav.set(bytes,44);return wav;
}
export async function transcribePcm(wav:Uint8Array,key:string,fetcher:typeof fetch,language='en'):Promise<{text:string}>{
 const form=new FormData();form.set('model','gpt-4o-mini-transcribe');form.set('language',language);form.set('response_format','json');form.set('file',new Blob([wav as BlobPart],{type:'audio/wav'}),'practice.wav');
 // Do not prime recognition with the target passage: hallucinated target words would move the reader incorrectly.
 const response=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Fault(502,'Transcription could not finish. Pause and try again.');
 const data=await response.json();if(typeof data.text!=='string'||data.text.length>3000)throw new Fault(502,'No usable transcript returned.');
 return {text:data.text.trim()};
}
