import { Fault } from '../winelens-research/domain.ts';
/** Only public wine facts and explicitly contributed bottle assets. No collection/user queries. */
export async function sharedCatalog(db:any,after=''){
 let query=db.from('wines').select('id,name,producer,region,country,grape,color,tasting_notes,metadata').like('id','community-%').order('id').limit(200);
 if(after){if(!/^community-[a-f0-9-]{36}$/.test(after))throw new Fault(400,'Invalid catalog cursor.');query=query.gt('id',after);}
 const result=await query;if(result.error)throw new Fault(503,'Catalog refresh unavailable. Your downloaded wines remain available.');
 const rows=result.data.filter((w:any)=>!w.metadata?.hidden);
 const items=await Promise.all(rows.map(async(w:any)=>{
  const published=Array.isArray(w.metadata.published_vintage_ids)?new Set(w.metadata.published_vintage_ids):null;
  const vintages=await db.from('sommni_vintages').select('id,vintage_key').eq('wine_id',w.metadata.canonical_wine_id).is('merged_into',null);
  if(published&&vintages.data)vintages.data=vintages.data.filter((v:any)=>published.has(v.id));
  if(vintages.error)throw new Fault(503,'Wine vintages could not be loaded.');
  const evidence=await db.from('wl_community_wines').select('id').in('canonical_vintage_id',vintages.data.map((v:any)=>v.id)).neq('status','declined');
  if(evidence.error)throw new Fault(503,'Wine evidence could not be loaded.');
  let image_url:string|undefined;
  if(evidence.data.length){
   let artwork=db.from('wl_community_artwork').select('photo_path').in('wine_id',evidence.data.map((e:any)=>e.id));
   if(w.metadata.published_at)artwork=artwork.lte('created_at',w.metadata.published_at);
   const assets=await artwork.order('created_at',{ascending:false}).limit(1);
   if(assets.data?.[0])image_url=(await db.storage.from('sommni-master-bottles').createSignedUrl(assets.data[0].photo_path,86400)).data?.signedUrl;
  }
  return {id:w.id,wine_name:w.name,producer:w.producer,country:w.country,region:w.region,grape:w.grape,color:w.color,tasting_notes:w.tasting_notes,sake_classification:w.metadata.sake_classification||'',sake_style:w.metadata.sake_style||'',rice_variety:w.metadata.rice_variety||'',
   verification:'Community supplied · confirm exact vintage details',reference_url:w.metadata.reference_url||'',vintages:vintages.data.map((v:any)=>v.vintage_key),image_url};
 }));
 return {items,next:result.data.length===200?result.data.at(-1).id:null};
}
