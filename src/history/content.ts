import { PLACE_SOURCES } from './place-stories';
import { allCatalogWines, lookupWineById, type CatalogWine } from '../identity';
import { catalogStory, CATALOG_STORY_SOURCES } from './catalog-stories';

export type StoryTopic = 'region' | 'wine' | 'time';
export interface StoryCard { id: string; date: string; title: string; cue: string; detail: string; source: string; scope: string; practice?: string }
export interface StorySource { publisher: string; title: string; url: string; checked: string; kind?: 'editorial' | 'catalog' }
const source = (publisher: string, title: string, url: string): StorySource => ({publisher,title,url,checked:'2026-10-16'});
export const STORY_SOURCES: Record<string, StorySource> = {
  ...CATALOG_STORY_SOURCES,
  ...PLACE_SOURCES,
  malbec: {...source('Wines of Argentina','Malbec in numbers · historical timeline',''),checked:'2026-10-19'},
  terrazasVineyards: {...source('Terrazas de los Andes','The Mendoza vineyards',''),checked:'2026-10-19'},
  ebnerSoils: {...source('Ebner-Ebenauer','Soils and old vines',''),checked:'2026-10-19'},
  ebnerCellar: {...source('Ebner-Ebenauer','The cellar',''),checked:'2026-10-19'},
  terrazas: source('Moët Hennessy Japan','The story of Terrazas',''),
  margauxRegion: source('Maison du Vin Margaux','The Margaux appellation',''),
  margaux: source('Château Margaux','Estate history',''),
  weinviertel: source('Weinviertel Tourism','Weinviertel and its wines',''),
  ebner: source('Ebner-Ebenauer','The estate',''),
  vintage: source('WSET','How to find a wine you like',''),
  weather: source('WSET','Weather, wine and vintages',''),
  fermentation: source('WSET','What is wine?',''),
  stages: source('WSET','Level 2 wine specification',''),
  ageing: source('WSET','Why do we age wine?',''),
  champagne: source('Comité Champagne','From cellar to table',''),
  example: source('Ebner-Ebenauer','Hermanschachern 2022 technical sheet',''),
};
export const TOPIC_LABELS: Record<StoryTopic,string> = {region:'Origins & place',wine:'Documented origins',time:'Timeline & context'};
const card = (id:string,date:string,title:string,cue:string,detail:string,source:string,scope:string): StoryCard => ({id,date,title,cue,detail,source,scope});

const MALBEC = {
 region: [
  card('malbec-1853','1853','A grape finds another home','Malbec’s Argentine story begins with a journey. The grape arrived in 1853 and became closely associated with Mendoza.',
   'Malbec comes from southwest France, where it is also called Côt. Wines of Argentina credits the French agronomist Michel Aimé Pouget with its introduction. In 1853 he was invited to run Mendoza’s agricultural school and adapt French grapes to local conditions. Later, Italian and French immigrants helped expand Argentine viticulture. The story continued through an emphasis on origin: Luján de Cuyo established its DOC in 1991. The modern identity of Argentine Malbec grew from people, adaptation and increasingly specific places.', 'malbec','Regional history'),
  card('terrazas-landscape','The vineyard landscape','Mendoza is more than one place','Terrazas describes its vineyards as a mosaic of mountain sites, with irrigation bringing glacier water to the vines.',
   'The differences become concrete in the vineyard names. Las Compuertas sits in Luján de Cuyo at 1,070 metres. Los Castaños is in Paraje Altamira at 1,100 metres; the producer identifies it as a source for Grand Malbec. These are useful landmarks when explaining why one regional name can contain several vineyard stories. The exact proportions in your bottle still require its vintage technical sheet.', 'terrazasVineyards','Producer vineyard context'),
 ],
 wine: [
  card('terrazas-1898','1898','A winery before the brand','Sotero Arizu built the Perdriel winery in 1898. Terrazas later restored the building and made it its winery.',
   'The Spanish-style building faces the Cordón del Plata. Its history predates the brand now working inside it, linking today’s winery to an earlier generation of Argentine wine production. The international connection developed later: in 1952, Moët & Chandon winemaker Renaud Poirier travelled to Argentina to assess its potential. Mendoza became the setting for a new chapter in that relationship.', 'terrazas','Estate history'),
  card('terrazas-1929','1929','The vineyard has its own clock','The producer traces ungrafted Malbec vines at Las Compuertas to 1929, and plantings at Altamira to 1945.',
   'These plantings place the vineyard story decades before the creation of Terrazas de los Andes, which the brand timeline dates to 1999. The same timeline records the creation of Cheval des Andes through a partnership with Château Cheval Blanc. The distinction is useful: a winery building, a vineyard and a brand can each have a different starting date. A vintage is another clock again, tied to the harvest.', 'terrazas','Vineyard history'),
  card('terrazas-sites','Reading the landscape','A story you can locate','The producer describes Los Cerezos as a hilly part of Las Compuertas, with drainage, sunny days and cool nights.',
   'Licán, at 1,200 metres in the Uco Valley, has slopes and natural watercourses that shape air drainage. These descriptions make altitude more meaningful than a number alone. For practice, explain a site as a combination of elevation, landform and water. Then return to what you actually observe in the glass; a landscape description is context, not proof of a specific aroma.', 'terrazasVineyards','Producer vineyard context'),
 ],
};
const MARGAUX = {
 region: [
  card('margaux-1855-region','1855','A famous name, a whole landscape','Margaux is a winegrowing appellation as well as the name of a famous château. Its area is home to 21 estates in the 1855 classification.',
   'Picture the vineyards between the Gironde estuary and the Atlantic, on gravelly rises. The regional body describes a temperate setting and gravel-rich soils. Start a wine introduction with that landscape before naming the estate: it helps the listener separate place from producer. The classification is a historical framework for estates, not a tasting score for the bottle in front of you.', 'margauxRegion','Regional history'),
  card('margaux-1954','1954','Place becomes an appellation','Margaux received AOC recognition on 10 August 1954, long after winegrowing had established its reputation.',
   'The regional body traces a major expansion of its vineyards to seventeenth-century drainage work. The later designation gives the place a defined identity. Today Cabernet Sauvignon, Merlot, Cabernet Franc and Petit Verdot form the main grape vocabulary. Learn the names, but check the producer’s release information for the actual blend rather than reciting a fixed recipe.', 'margauxRegion','Appellation history'),
 ],
 wine: [
  card('margaux-1855-estate','1855','A reputation carried forward','Château Margaux became a First Growth in 1855, confirming an already international reputation.',
   'The estate’s international reputation was already developing long before that classification. Its history records a London auction in 1705 and Thomas Jefferson’s purchase of the 1784 vintage. The classification formalised an established hierarchy rather than creating the estate’s reputation overnight.', 'margaux','Estate history'),
  card('margaux-1977','1977','Restoration reaches the vineyard','André Mentzelopoulos bought Château Margaux in 1977 and invested in its recovery.',
   'The estate records drainage and replanting, stricter selection for Pavillon Rouge, and work with oenologist Émile Peynaud. André also redefined Pavillon Blanc, introduced new oak ageing and planned a major underground cellar. Investment reached both the vineyard and the way its fruit was selected and handled. According to the estate, the acclaimed 1978 vintage quickly reflected the impact of that work.', 'margaux','Estate history'),
  card('margaux-1980','1980','Continuity after a sudden handover','After André’s death, Corinne Mentzelopoulos took responsibility for the estate and continued its investment programme.',
   'Supported by Émile Peynaud and the technical team, she carried the work forward as international demand for Bordeaux grew. The estate’s account links this period to sustained investment and long-term stewardship: the recovery became an ongoing project rather than a single owner’s intervention.', 'margaux','Estate history'),
 ],
};
const GRUNER = {
 region: [
  card('weinviertel-2003','2003','A region puts its name first','Weinviertel became Austria’s first DAC region in 2003, making its characteristic Grüner Veltliner a recognisable regional calling card.',
   'DAC identifies a wine through its origin and regional style. The regional tourism body describes Weinviertel DAC as dry, fruity, spicy and peppery. Those are reference expectations to explore, not words you must force into your own tasting note. Check the bottle’s designation: the generic catalogue name does not establish that an individual cuvée carries DAC.', 'weinviertel','Regional history'),
  card('weinviertel-cellars','Life around wine','The cellar is part of the landscape','Weinviertel is known for its Kellergassen: lanes lined with wine cellars, connecting wine to the everyday life of the region.',
   'Poysdorf sits on the regional wine route. This gives you a human opening for the wine: a place of cellar lanes and winegrowers rather than a list of grape facts. Move from that regional setting to Ebner-Ebenauer’s own courtyard and cellar, where the estate’s story becomes more personal.', 'weinviertel','Regional culture'),
 ],
 wine: [
  card('ebner-1945','1945','Rebuilding with memories of elsewhere','Fire largely destroyed the family estate in 1945. Manfred’s grandparents rebuilt it with influences from their time in France and Italy.',
   'The producer connects the courtyard’s Mediterranean character to those experiences. Its winding spaces sit within a property the family describes as belonging to fourteen generations of winegrowers. Beneath the buildings is a cellar with a much older history. The contrast between a rebuilt courtyard and an inherited working cellar gives the estate’s story both a visible surface and a less obvious depth.', 'ebner','Producer history'),
  card('ebner-2012','2012','Two people, one place','Marion and Manfred carefully renovated the estate in 2012, bringing their shared interest in art and architecture into its older spaces.',
   'Their account presents complementary temperaments: Manfred’s quiet concentration on cellar work and Burgundy alongside Marion’s outward-looking energy and experience as a négociante. The renovated spaces express a shared commitment to the property. It is a partnership rooted in an inherited place, shaped by two different ways of approaching wine and the people around it.', 'ebner','Producer history'),
  card('ebner-soils','Around Poysdorf','Scattered vineyards, distinct voices','Ebner-Ebenauer’s vineyards are spread around Poysdorf. The producer explains that this distribution historically helped spread the risk of local hail damage.',
   'Today those scattered plots offer loess, sand, limestone, gravel and clay. The estate describes seven different Grüner Veltliners arising from this variety of sites. This makes the cuvée name especially useful: two wines from one producer and one grape need not tell the same story. To practise, explain why you would ask for the vineyard or cuvée before attaching a detailed description to the bottle.', 'ebnerSoils','Producer vineyard context'),
  card('ebner-cellar','Below the courtyard','Gravity, patience and careful handling','The producer describes a centuries-old cellar arranged over three levels, with gravity still helping move the grape juice through the building.',
   'The estate reports hand harvesting into 25-kilogram crates and cooling grapes before processing. Gravity reduces reliance on pumps. Skin contact is another deliberate choice: the producer describes extended maceration for white wines, including 48 hours for its Black Edition line. Its single-vineyard wines remain unbottled until at least May, allowing time on the lees. These details describe a house approach to handling, texture and patience; the Black Edition practice does not automatically apply to every Grüner Veltliner.', 'ebnerCellar','Producer cellar context'),
 ],
};
export const TIME_CARDS: StoryCard[] = [
 card('time-season','01 · Growing season','Weather becomes a vintage','Each growing season shapes the grapes. The same wine can differ from one harvest year to another.','Climate describes a longer pattern; a vintage reflects the conditions of a particular season. A year alone does not guarantee quality.','weather','General wine education'),
 card('time-vintage','02 · Harvest','What the vintage means','The vintage is the grape harvest year. It is not the bottling or release year.','A label saying 2017 points to a harvest, not seven or nine years in barrel. No exact harvest day or bottle age is inferred here.','vintage','General wine education'),
 card('time-fermentation','03 · After harvest','Grapes become wine','During alcoholic fermentation, yeast converts grape sugars into alcohol. Timing depends on the wine and process.','Fermentation time is a production duration. It is not the same as years spent maturing in a cellar.','fermentation','General wine education'),
 card('time-maturation','04 · Before bottling','Time in the cellar','Wine may mature in tank, barrel or other vessels before bottling. That duration is separate from bottle age.','No barrel duration is verified for the selected release. Oak ageing cannot be inferred simply from the wine’s age.','ageing','General wine education'),
 card('time-bottling','05 · Bottling','A new stage begins','The bottling date marks when wine enters its bottle. It can be later than the harvest year.','Bottling and commercial release are separate events. A vintage alone cannot establish either date.','stages','General wine education'),
 card('time-release','06 · Release','Ready for sale','Release is when a producer makes a wine available. Some wines spend time in bottle before release.','Release does not mean the wine is at a universal peak. Dates for the selected bottle remain unverified.','ageing','General wine education'),
 card('time-drinking','07 · Bottle development','A window, not a deadline','Some wines develop with bottle age; others are intended for youth. Storage and personal taste matter.','A drinking window is an estimate, not an expiry date or guarantee. This app does not invent one from the vintage.','ageing','General wine education'),
 card('time-nv','Label guide · NV','More than one harvest','Non-vintage Champagne commonly blends wines from different harvests. NV does not mean the wine has no age.','This is a Champagne example, not a claim that the selected still wine is non-vintage.','champagne','Champagne label education'),
 card('time-disgorgement','Label guide · Disgorged','Another date on sparkling wine','Disgorgement removes lees from traditional-method sparkling wine. Its date is separate from the grape harvest.','Time before and after disgorgement describe different stages. Do not treat the disgorgement date as the vintage.','champagne','Traditional-method sparkling wine'),
];
export const RELEASE_EXAMPLE: StoryCard[] = [
 card('example-harvest','September 2022','Harvest','Hermanschachern 2022: grapes harvested in September 2022.','This documented example is a named Ebner-Ebenauer cuvée. It is not automatically the generic Grüner Veltliner entry in the catalogue.','example','Separate named example'),
 card('example-lees','Six months','Fine-lees ageing','The producer reports six months on the fine lees.','This is a duration, not a vintage or calendar date. The sheet does not provide an exact start and end date for every process.','example','Separate named example'),
 card('example-bottle','May 2023','Bottling','The producer records bottling in May 2023, after the 2022 harvest.','This shows why the vintage and bottling year can differ.','example','Separate named example'),
 card('example-window','2023–2033','Suggested drinking window','The producer suggests 2023–2033 for this exact cuvée and vintage.','This is producer guidance, dependent on bottle condition and storage. It must not be applied to another wine or vintage.','example','Producer estimate; separate example'),
];
const PRACTICE:Record<string,string>={
 'malbec-1853':'Introduce the wine in twenty seconds: grape, country, region and producer.',
 'terrazas-landscape':'Explain why two sites within Mendoza can deserve different descriptions.',
 'terrazas-1898':'Tell the building’s story without confusing its age with the vintage.',
 'terrazas-1929':'Explain vine age, wine age and vintage in your own words.',
 'terrazas-sites':'Describe a vineyard using three concrete features, then one question you would ask.',
 'margaux-1855-region':'Explain the difference between Margaux the place and Château Margaux.',
 'margaux-1954':'Explain what an appellation tells you, then what you still need to check.',
 'margaux-1855-estate':'Introduce the estate without using the words famous, prestigious or best.',
 'margaux-1977':'Choose one restoration decision and explain why you remember it.',
 'margaux-1980':'Retell the change in stewardship in two connected sentences.',
 'weinviertel-2003':'Explain DAC, then separate regional expectations from your own tasting.',
 'weinviertel-cellars':'Set the scene for someone who has never visited Weinviertel.',
 'ebner-1945':'Tell the courtyard story in thirty seconds without reading.',
 'ebner-2012':'Explain the partnership in your own words.',
 'ebner-soils':'Explain why the exact cuvée matters even when producer and grape match.',
 'ebner-cellar':'Connect one cellar feature to one working practice.'
};
for(const story of [MALBEC,MARGAUX,GRUNER])for(const group of [story.region,story.wine])for(const c of group)c.practice=PRACTICE[c.id];
for(const key of ['terrazas','margaux','margauxRegion','ebner','weinviertel'])STORY_SOURCES[key].checked='2026-10-19';
export function storyWines(): CatalogWine[] { return allCatalogWines(); }
export function storyCards(wineId: string, topic: StoryTopic): StoryCard[] {
  const wine=lookupWineById(wineId);
  if(!wine)return [];
  if(topic === 'time') return wineHistoryCards(wineId);
  const story=wine.legacyId==='w0'?MALBEC: wine.legacyId==='w5'?MARGAUX: wine.legacyId==='w117'?GRUNER:null;
  return story?.[topic] ?? catalogStory(wine,topic);
}

/** One coherent collection per wine, with no repeated general chronology. */
export function wineHistoryCards(wineId: string): StoryCard[] {
  const seen = new Set<string>();
  return [...storyCards(wineId,'wine'), ...storyCards(wineId,'region')].filter(card => {
    const key=card.source+'|'+card.cue;
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>{
    const year=(c:StoryCard)=>/^\d{4}$/.test(c.date)?Number(c.date):Infinity;
    return year(a)-year(b);
  });
}
export function textParagraphs(text: string): string[] {
  if(/\n\s*\n/.test(text))return text.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
  // Keep abbreviations intact; split only at sentence endings followed by capitals.
  const sentences=text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
  const paragraphs:string[]=[];
  for(let i=0;i<sentences.length;i+=2)paragraphs.push(sentences.slice(i,i+2).join(' ').trim());
  return paragraphs.filter(Boolean);
}
export function storyParagraphs(card: StoryCard): string[] { return [card.cue,...textParagraphs(card.detail)]; }
