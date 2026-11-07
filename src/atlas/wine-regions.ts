import { normalizePlace } from './place-search';
import type { AtlasData, Region } from './renderer';
import type { Boundaries, BoundaryRegion } from './globe-model';

// Wine regions are browsing groups, not administrative borders or new winery locations.
// Geography evidence is retained in the release notes, not shipped as research URLs.
export const WINE_REGIONS = [
  { id:'wine:FRA:bordeaux', name:'Bordeaux', country:'FRA', center:[-.45,44.9] as [number,number], radius:.9,
    departments:['Gironde'], places:['Bordeaux','Bordeaux Supérieur','Médoc','Haut-Médoc','Margaux','Pauillac','Saint-Estèphe','Saint-Julien','Pomerol','Lalande-de-Pomerol','Saint-Émilion','Saint-Émilion Grand Cru','Graves','Pessac-Léognan','Sauternes','Barsac','Fronsac','Canon-Fronsac','Blaye','Bourg','Côtes de Bourg','Côtes de Bordeaux','Blaye Côtes de Bordeaux','Castillon Côtes de Bordeaux','Francs Côtes de Bordeaux','Cadillac Côtes de Bordeaux','Entre-Deux-Mers'] },
  { id:'wine:FRA:burgundy', name:'Burgundy / Bourgogne', country:'FRA', center:[4.4,47.0] as [number,number], radius:1.5,
    departments:['Yonne','Côte-d’Or','Saône-et-Loire'], places:['Burgundy','Bourgogne','Chablis','Petit Chablis','Grand Auxerrois','Côte de Nuits','Côte de Beaune','Côte Chalonnaise','Mâconnais','Mâcon','Mâcon-Villages','Pouilly-Fuissé','Saint-Véran','Viré-Clessé','Gevrey-Chambertin','Morey-Saint-Denis','Chambolle-Musigny','Vougeot','Vosne-Romanée','Nuits-Saint-Georges','Aloxe-Corton','Corton','Corton-Charlemagne','Beaune','Pommard','Volnay','Meursault','Puligny-Montrachet','Chassagne-Montrachet','Santenay','Rully','Mercurey','Givry','Montagny'] },
];
export type WineRegion = typeof WINE_REGIONS[number];
export const wineRegionById=(id:string)=>WINE_REGIONS.find(r=>r.id===id);
export function wineRegionFor(country:string,place:string):WineRegion|undefined {
  if(!['fr','fra','france'].includes(normalizePlace(country)))return;
  const name=normalizePlace(place.split(',')[0]);
  return WINE_REGIONS.find(r=>r.places.some(p=>normalizePlace(p)===name));
}
export function wineRegionRows(data:AtlasData):Region[] {
  return WINE_REGIONS.filter(area=>data.countries.some(c=>c.code===area.country)).map(area=>{
    const clusters=data.regions.filter(r=>wineRegionFor(r.country,r.name)?.id===area.id);
    const points=[...new Map(clusters.flatMap(r=>r.points).map(p=>[p.join(','),p])).values()];
    return {id:area.id,name:area.name,country:area.country,center:area.center,radius:area.radius,
      sourceKey:'',points,count:points.length,geometryKind:'winery-cluster'};
  });
}
/** Existing department polygons provide orientation only, never claimed as an appellation. */
export function wineRegionContexts(boundaries:Boundaries):BoundaryRegion[] {
  return WINE_REGIONS.flatMap(area=>{
    const parts=boundaries.regions.filter(r=>r.country===area.country&&area.departments.includes(r.name));
    if(!parts.length)return [];
    return [{id:area.id,name:area.name,country:area.country,kind:'Wine region · administrative context',center:area.center,
      bounds:[Math.min(...parts.map(r=>r.bounds[0])),Math.min(...parts.map(r=>r.bounds[1])),Math.max(...parts.map(r=>r.bounds[2])),Math.max(...parts.map(r=>r.bounds[3]))] as [number,number,number,number],
      polygons:parts.flatMap(r=>r.polygons),clusters:[...new Set(parts.flatMap(r=>r.clusters))],pointCount:parts.reduce((n,r)=>n+r.pointCount,0)}];
  });
}
