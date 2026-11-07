import {canonicalCountry,originKey,wineOrigin} from '../wine-origin';
import links from '../data/atlas-region-links.json';
import {prefectureKey} from '../sake';
import type {AtlasData,Country,Region} from './renderer';
import {fitCamera,regionAt,type Boundaries,type BoundaryRegion,type Camera} from './globe-model';
export interface OriginInput {country?:string|null;region?:string|null;state?:string|null}
export function locateWine(data:AtlasData,input:OriginInput){
 const origin=wineOrigin(input.country,input.region,input.state);
 const country=data.countries.find(c=>canonicalCountry(c.name)===origin.country||c.code===String(input.country).toUpperCase())??null;
 if(!country)return {country:null,cluster:null,origin};
 const candidates=data.regions.filter(r=>r.country===country.code);
 let cluster:Region|null=null;
 for(const place of [...origin.places].reverse()){
  const exact=candidates.filter(r=>originKey(wineOrigin(country.name,r.name).region)===originKey(place)||(country.code==='JPN'&&prefectureKey(r.name)===prefectureKey(place)));
  if(exact.length===1){cluster=exact[0];break;}
  const linked=links.links.filter(l=>originKey(wineOrigin(country.name,l.region).region)===originKey(place)).flatMap(l=>l.clusters);
  const hits=candidates.filter(r=>linked.includes(r.name));if(hits.length===1){cluster=hits[0];break;}
 }
 return {country,cluster,origin};
}
export interface WineFocus {country:Country;cluster:Region|null;boundary:BoundaryRegion|null;camera:Camera;path:string[];precision:'region'|'administrative'|'country'}
export function resolveWineFocus(data:AtlasData,boundaries:Boundaries,input:OriginInput):WineFocus|null{
 const {country,cluster,origin}=locateWine(data,input);if(!country)return null;
 const admins=boundaries.regions.filter(r=>r.country===country.code);
 const matches=(r:BoundaryRegion,p:string)=>originKey(wineOrigin(country.name,r.name).region||r.name)===originKey(p);
 const explicit=admins.find(r=>matches(r,origin.subdivision))??[...origin.places].reverse().map(p=>admins.find(r=>matches(r,p))).find(Boolean);
 const boundary=explicit??(cluster?regionAt(cluster.center,admins):null)??null;
 let camera=fitCamera(boundary?.polygons??boundaries.countries[country.code]??[]);
 if(cluster){const center:Camera['center']=boundary?[cluster.center[0]*.85+boundary.center[0]*.15,cluster.center[1]*.85+boundary.center[1]*.15]:[...cluster.center];camera={center,zoom:Math.min(18,Math.max(6,boundary?camera.zoom:12))};}
 const path=[country.name,origin.subdivision||boundary?.name,...origin.places].filter((p,i,a):p is string=>!!p&&a.findIndex(v=>originKey(v)===originKey(p))===i);
 return {country,cluster,boundary,camera,path,precision:cluster?'region':boundary?'administrative':'country'};
}
/** Shortest-path, interruption-safe camera interpolation; keeps dateline crossings local. */
export function blendWineCamera(from:Camera,to:Camera,progress:number):Camera{
 const t=Math.max(0,Math.min(1,progress)),ease=1-(1-t)**3,delta=((to.center[0]-from.center[0]+540)%360)-180;
 return {center:[((from.center[0]+delta*ease+540)%360)-180,from.center[1]+(to.center[1]-from.center[1])*ease],zoom:from.zoom+(to.zoom-from.zoom)*ease};
}
