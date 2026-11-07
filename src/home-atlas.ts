import {loadAtlasRenderer} from './atlas-app';
import {createBrowserAtlas} from './atlas/browser-explorer';
/** Atlas is a primary Home feature, independent of optional promotional/rehearsal panels. */
export function initHomeAtlas(){
 const host=document.getElementById('atlas-explorer-host');if(!host)return;
 const root=document.createElement('section');root.id='dot-dialog';root.className='atlas-inline';root.setAttribute('aria-labelledby','dot-title');host.replaceChildren(root);
 let atlas:Awaited<ReturnType<typeof createBrowserAtlas>>|null=null,loading=false;
 const open=async(navigate=false)=>{
 if(navigate){document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();root.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
 if(loading||atlas)return;loading=true;root.innerHTML='<p role="status">Loading your wine atlas…</p>';
 try{const renderer=await loadAtlasRenderer(),country=renderer.data.countries.find(c=>c.code==='ITA')??renderer.data.countries[0];if(!country)throw Error('No mapped countries');const selection={country,region:null,label:country.name};atlas=await createBrowserAtlas(root,renderer,selection);atlas.open(selection);}
 catch{root.innerHTML='<p role="status">Atlas could not load.</p><button class="wl-outline">Retry Atlas</button>';root.querySelector('button')!.onclick=()=>void open();}finally{loading=false;}
 };
 window.addEventListener('winelens-open-browser-atlas',()=>void open(true));void open();
}
