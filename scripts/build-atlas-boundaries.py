"""Build simplified public-domain country/admin-1 polygons and exact source-point counts.
Input pinned Natural Earth files are cached outside the app; no live map requests.
"""
import json, math, hashlib, pathlib, urllib.request
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
ROOT=pathlib.Path(__file__).resolve().parents[1]; CACHE=ROOT.parent/'geography-source'; CACHE.mkdir(exist_ok=True)
COMMIT='ca96624a56bd078437bca8184e78163e5039ad19'
SOURCES={k:f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{COMMIT}/geojson/{v}.geojson' for k,v in {'countries':'ne_50m_admin_0_countries','admin1':'ne_10m_admin_1_states_provinces'}.items()}
raw={}
for k,url in SOURCES.items():
 p=CACHE/(k+'.geojson')
 if not p.exists():p.write_bytes(urllib.request.urlopen(url).read())
 raw[k]=p.read_bytes()
def polygons(g):return g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
def simplify(ring,tolerance):
 keep={0,len(ring)-1};stack=[(0,len(ring)-1)]
 while stack:
  a,b=stack.pop();x,y=ring[a][:2];dx,dy=ring[b][0]-x,ring[b][1]-y;den=dx*dx+dy*dy;far=-1;index=a
  for i in range(a+1,b):
   px,py=ring[i][0]-x,ring[i][1]-y;t=max(0,min(1,(px*dx+py*dy)/den)) if den else 0;d=(px-t*dx)**2+(py-t*dy)**2
   if d>far:far=d;index=i
  if far>tolerance*tolerance:keep.add(index);stack.extend([(a,index),(index,b)])
 result=[[round(ring[i][0],4),round(ring[i][1],4)] for i in sorted(keep)]
 if len(result)<4:result=[[round(p[0],4),round(p[1],4)] for p in ring]
 return result
def inside_ring(point,ring):
 x,y=point;yes=False;j=len(ring)-1
 for i,(a,b,*_) in enumerate(ring):
  c,d=ring[j][:2]
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:yes=not yes
  j=i
 return yes
def inside(point,polys):return any(inside_ring(point,p[0]) and not any(inside_ring(point,h) for h in p[1:]) for p in polys)
def bounds(polys):
 points=[v for p in polys for v in p[0]];return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
atlas=json.loads((ROOT/'public/atlas/atlas-data.json').read_text());codes={c['code'] for c in atlas['countries']}
country_shapes={f['properties']['ADM0_A3']:[[simplify(r,.06) for r in p] for p in polygons(f['geometry'])] for f in json.loads(raw['countries'])['features']}
regions=[];original={}
# Natural Earth's Italian entries are provinces, with region/region_cod parents.
# Dissolve BEFORE simplifying so shared province edges disappear from the region outline.
features=json.loads(raw['admin1'])['features']
italian_groups={}
for feature in features:
 props=feature['properties']
 if props['adm0_a3']=='ITA':
  italian_groups.setdefault(props['region_cod'],[]).append(feature)
assert len(italian_groups)==20, 'Expected all 20 Italian regions'
regional_names={
 'Piemonte':'Piedmont (Piemonte)', 'Toscana':'Tuscany (Toscana)',
 'Lombardia':'Lombardy (Lombardia)', 'Apulia':'Apulia (Puglia)',
 'Sardegna':'Sardinia (Sardegna)', 'Sicily':'Sicily (Sicilia)',
 "Valle d'Aosta":"Aosta Valley (Valle d'Aosta)",
 'Trentino-Alto Adige':'Trentino-Alto Adige / South Tyrol',
}
features=[f for f in features if f['properties']['adm0_a3']!='ITA']
for code,members in sorted(italian_groups.items()):
 name=members[0]['properties']['region']
 merged=unary_union([shape(f['geometry']) for f in members])
 assert merged.is_valid and merged.geom_type in ('Polygon','MultiPolygon'), code
 features.append({'geometry':mapping(merged),'properties':{
  'adm0_a3':'ITA','adm1_code':code,'name':regional_names.get(name,name),
  'type_en':'Region','provinces':[f['properties']['name_en'] or f['properties']['name'] for f in members]
 }})
for f in features:
 p=f['properties'];code=p['adm0_a3']
 if code not in codes:continue
 polys=polygons(f['geometry']);box=bounds(polys);largest=max(polys,key=lambda p:len(p[0]));bigbox=bounds([largest]);center=[(bigbox[0]+bigbox[2])/2,(bigbox[1]+bigbox[3])/2]
 row=dict(id=p['adm1_code'],name=p.get('name_en') or p['name'],country=code,kind=p.get('type_en') or 'Administrative region',center=center,bounds=box,polygons=[[simplify(r,.025) for r in poly] for poly in polys],clusters=[],pointCount=0)
 if p.get('provinces'):row['provinces']=p['provinces']
 original[row['id']]=polys;regions.append(row)
bycountry={code:[r for r in regions if r['country']==code] for code in codes}
for cluster in atlas['regions']:
 touched=set()
 for point in cluster['points']:
  x,y=point
  for r in bycountry[cluster['country']]:
   a,b,c,d=r['bounds']
   if a<=x<=c and b<=y<=d and inside(point,original[r['id']]):r['pointCount']+=1;touched.add(r['id']);break
 for r in bycountry[cluster['country']]:
  if r['id'] in touched:r['clusters'].append(cluster['id'])
output=dict(countries=country_shapes,regions=regions,provenance={'sources':SOURCES,'sha256':{k:hashlib.sha256(v).hexdigest() for k,v in raw.items()},'geometry':'Natural Earth administrative boundaries, simplified for display. Not wine appellation boundaries.','italy':'Italian provinces dissolved by Natural Earth region_cod into 20 parent regions before simplification. English and Italian names shown where they differ.',
'counts':'Recorded winery coordinates assigned to original admin-1 polygons. Source groups may cross administrative borders.'})
p=ROOT/'public/atlas/boundaries.json';p.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')));print({'countries':len(country_shapes),'regions':len(regions),'bytes':p.stat().st_size,'assignedPoints':sum(r['pointCount'] for r in regions)})
