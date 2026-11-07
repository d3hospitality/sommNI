/** Local ElevenLabs sound family. Only meaningful, foreground actions; never narration. */
export type FeedbackSound='saved'|'ready'|'linked';
export const feedbackSound=(kind:FeedbackSound)=>window.dispatchEvent(new CustomEvent('sommni-sound',{detail:{kind}}));
const FILES={saved:'bottle-saved.mp3',ready:'selection.mp3',linked:'linked.mp3'};
export function initSoundFeedback(){
 let enabled=true;try{enabled=localStorage.getItem('sommni-sound')!=='off';}catch{}
 let context:AudioContext|undefined,unlocked=false,last=0;
 const buffers=new Map<string,Promise<AudioBuffer>>();
 const unlock=()=>{if(!enabled)return;try{context??=new AudioContext();void context.resume().then(()=>{unlocked=context?.state==='running'}).catch(()=>{});}catch{}};
 document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
 const play=async(kind:FeedbackSound)=>{
  if(!enabled||!unlocked||!context||document.hidden||Date.now()-last<1000)return;last=Date.now();const ctx=context;
  try{let buffer=buffers.get(kind);if(!buffer){buffer=fetch(import.meta.env.BASE_URL+'sounds/'+FILES[kind]).then(r=>{if(!r.ok)throw Error('Sound unavailable');return r.arrayBuffer()}).then(data=>ctx.decodeAudioData(data));buffers.set(kind,buffer);void buffer.catch(()=>buffers.delete(kind));}
   const decoded=await buffer;if(!enabled||document.hidden||ctx.state!=='running')return;
   const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=decoded;gain.gain.value=kind==='ready'?.1:.18;source.connect(gain);gain.connect(ctx.destination);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
  }catch{/* Sound never blocks saving or changes a success into an error. */}
 };
 window.addEventListener('sommni-sound',e=>{const kind=(e as CustomEvent).detail?.kind;if(kind in FILES)void play(kind)});
 window.addEventListener('sommni-account-linked',()=>void play('linked'));
 const settings=document.querySelector('#tab-settings .wl-settings-grid');if(settings){const card=document.createElement('div');card.className='card';card.innerHTML='<div class="card-header">Sound</div><div class="card-body"><label class="setting-row"><span>Quiet feedback sounds</span><input type="checkbox" aria-label="Quiet feedback sounds"></label><p class="wl-muted small">A soft cue for a completed save, a ready wine list or a newly linked account. Plays through your phone. No spoken notes or background music.</p><button type="button" class="wl-text-button">Preview Sound</button></div>';settings.append(card);const input=card.querySelector('input')!;input.checked=enabled;input.onchange=()=>{enabled=input.checked;try{localStorage.setItem('sommni-sound',enabled?'on':'off')}catch{}if(!enabled)void context?.suspend();else unlock();};card.querySelector('button')!.onclick=()=>{unlock();void play('saved')};}
}
