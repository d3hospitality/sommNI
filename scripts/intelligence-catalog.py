"""Freeze the reviewed local catalog for server-side AI grounding; no client facts trusted."""
import json,re,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'src/constants.ts').read_text()
wines=json.JSONDecoder().raw_decode(s.split('export const WINES: Record<string, Record<string, Wine[]>> = ',1)[1])[0]
identity=json.loads((root/'src/data/catalog-identity.json').read_text())['entries']
regions=json.loads((root/'src/history/regions.json').read_text())
corrections=json.loads((root/'src/data/catalog-corrections.json').read_text())
rows=[]
for entry in identity:
 if entry['status']!='active':continue
 typ,country,name=entry['key'].split('|',2)
 wine=next(w for w in wines[typ][country] if w['name']==name)
 profile=regions['regions'].get(regions['assignments'].get(entry['legacy_id'],''))
 rows.append(dict(id=entry['id'],legacyId=entry['legacy_id'],type=typ,country=country,**{k:v for k,v in wine.items() if k!='anecdote'},context=profile,source=regions['sources'].get(profile['source']) if profile else None))
for row in rows:
 correction=corrections.get(row['id'])
 if correction:
  assert row[correction['field']]==correction['value']
  row['field_sources']={correction['field']:{key:correction[key] for key in ['publisher','title','url']}}
payload=json.dumps(rows,ensure_ascii=False,separators=(',',':'))
version=hashlib.sha256(payload.encode()).hexdigest()[:16]
(root/'supabase/functions/winelens-beta/data/catalog.json').write_text(json.dumps(dict(version=version,wines=rows),ensure_ascii=False,indent=2)+'\n')
print(f'{len(rows)} canonical wines, source version {version}')
