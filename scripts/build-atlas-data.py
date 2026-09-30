"""Build attributed, pinned offline map assets; no geocoding or paid API needed."""
import hashlib, json, math, pathlib, statistics, urllib.request
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/atlas'
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = {
 'world': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_countries.geojson',
 'wineries': 'https://raw.githubusercontent.com/oOo0oOo/winerymap/6aa35599993104b378cd86ed24eb2d76a0be60f8/vineyards.json',
 'license': 'https://raw.githubusercontent.com/oOo0oOo/winerymap/6aa35599993104b378cd86ed24eb2d76a0be60f8/LICENSE',
}
raw = {key: urllib.request.urlopen(url).read() for key, url in SOURCES.items()}
features = json.loads(raw['world'])['features']
winery_data = json.loads(raw['wineries'])
W,H=4096,2048
im=Image.new('RGB',(W,H)); draw=ImageDraw.Draw(im)
countries=[]
# Natural Earth polygons crossing the antimeridian are already split at +/-180.
for number, f in enumerate(features,1):
 p=f['properties']; code=p['ADM0_A3']
 name={'United States of America':'United States'}.get(p['ADMIN'],p['ADMIN'])
 countries.append(dict(id=number,code=code,name=name,center=[p['LABEL_X'],p['LABEL_Y']]))
 polys=f['geometry']['coordinates'] if f['geometry']['type']=='MultiPolygon' else [f['geometry']['coordinates']]
 for poly in polys:
  for ring_i,ring in enumerate(poly):
   xy=[((lon+180)/360*(W-1),(90-lat)/180*(H-1)) for lon,lat in ring]
   draw.polygon(xy,fill=(number,0,0) if not ring_i else (0,0,0))
im.save(OUT/'world-ids.png',optimize=True)
byname={c['name']:c for c in countries}
byname['Russian Federation']=byname['Russia']
byname['Serbia']=byname['Republic of Serbia']
byname['Czechia']=byname['Czechia'] if 'Czechia' in byname else byname['Czech Republic']
regions=[]; exclusions=[]
for key, group in winery_data.items():
 suffix=key.rsplit(', ',1)[-1]; country=byname.get(suffix)
 if not country:
  exclusions.append(dict(group=key,reason='No explicit country match',points=len(group['vineyards'])));continue
 points=[[round(v[1],4),round(v[0],4)] for v in group['vineyards'] if -90<=v[0]<=90 and -180<=v[1]<=180]
 if not points:continue
 # Circular mean prevents a dateline cluster being centered near Greenwich.
 lon=math.degrees(math.atan2(sum(math.sin(math.radians(v[0])) for v in points),sum(math.cos(math.radians(v[0])) for v in points)))
 lat=statistics.mean(v[1] for v in points)
 def dist(v):
  return math.degrees(math.acos(max(-1,min(1, math.sin(math.radians(lat))*math.sin(math.radians(v[1]))+math.cos(math.radians(lat))*math.cos(math.radians(v[1]))*math.cos(math.radians(v[0]-lon))))))
 distances=sorted(dist(v) for v in points)
 # Robust framing; distant source outliers remain in the data but need not dominate view.
 radius=max(0.12,distances[min(len(distances)-1,int(len(distances)*.95))]*1.4)
 regions.append(dict(id=hashlib.sha256(key.encode()).hexdigest()[:12],name=key.rsplit(', ',1)[0],sourceKey=key,country=country['code'],center=[round(lon,5),round(lat,5)],radius=round(min(50,radius),3),points=points,count=len(points),geometryKind='winery-cluster'))
regions.sort(key=lambda r:(r['country'],r['name']))
for c in countries:
 c['regionCount']=sum(r['country']==c['code'] for r in regions)
 c['wineryCount']=sum(r['count'] for r in regions if r['country']==c['code'])
data=dict(version=1,countries=countries,regions=regions,provenance=dict(sources=SOURCES,sha256={k:hashlib.sha256(v).hexdigest() for k,v in raw.items()},sourceCollectionPeriod='August–October 2024',sourcePointCount=sum(len(v['vineyards']) for v in winery_data.values()),excluded=exclusions,regionGeometry='Point clusters from source grouping; not appellation boundaries',borders='Natural Earth 1:50m admin-0, including countries and territories; cartographic simplification'))
(OUT/'atlas-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
(OUT/'WINERYMAP-LICENSE.txt').write_bytes(raw['license'])
(OUT/'SOURCES.md').write_text('# wineLENS Atlas sources\n\nCountry geography: [Natural Earth](https://www.naturalearthdata.com/), public domain. The 1:50m admin-0 dataset includes countries and territories. Borders are simplified, not a statement of political recognition.\n\nWinery locations and region groupings: [Oliver Dressler / winerymap](https://github.com/oOo0oOo/winerymap), MIT, data collected August–October 2024. License retained alongside this file. Region centers are calculated from source points; they are not legal appellation centroids or polygons. Winery counts describe this dataset, not all operating wineries.\n\nPinned source URLs, hashes and exclusions are in atlas-data.json. No external tiles, live location permission, tracking, or runtime geocoding.\n')
print(json.dumps(dict(countries=len(countries),regions=len(regions),points=sum(r['count'] for r in regions),excluded=exclusions,bytes=sum(p.stat().st_size for p in OUT.iterdir() if p.is_file())),indent=2))
