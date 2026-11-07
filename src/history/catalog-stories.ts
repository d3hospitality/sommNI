import type { CatalogWine } from '../identity';
import type { StoryCard, StorySource } from './content';
import data from './regions.json';
const profiles:Record<string,{title:string;cue:string;detail:string;question:string;source:string}>=data.regions;
const assignment:Record<string,string>=data.assignments;
export const CATALOG_STORY_SOURCES:Record<string,StorySource>={...data.sources,
 editorial:{publisher:'sommNI',title:'How these stories are written',url:'wine-story-method.html',checked:'2026-10-19',kind:'editorial'},
 catalog:{publisher:'sommNI catalogue',title:'Reference notes · release unconfirmed',url:'wine-story-method.html',checked:'2026-10-19',kind:'catalog'},
 fontodi:{publisher:'Fontodi',title:'Case Via Syrah technical sheet',url:'',checked:'2026-10-19'},
 peters:{publisher:'Pierre Péters',title:'Cuvée de Réserve',url:'',checked:'2026-10-19'},
 laurentRose:{publisher:'Laurent-Perrier',title:'Cuvée Rosé',url:'',checked:'2026-10-19'},
};
for(const key of ['veneto','maconnais'])CATALOG_STORY_SOURCES[key].kind='editorial';
const chapter=(id:string,title:string,cue:string,detail:string,source:string,scope:string,practice:string):StoryCard=>({id,date:'The wine in context',title,cue,detail,source,scope,practice});
export function catalogStory(entry:CatalogWine,topic:'region'|'wine'):StoryCard[] {
 const region=profiles[assignment[entry.legacyId??'']];if(!region)return [];
 return [chapter('place-'+region.source,region.title,region.cue,region.detail,region.source,CATALOG_STORY_SOURCES[region.source].kind?'Label context · editorial':'Regional insight',region.question)];
}
