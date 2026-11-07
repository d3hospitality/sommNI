/** Editorial teaching references, paraphrased from primary wine-education sources.
 * These explain vocabulary, not this producer's practices or an unconfirmed vintage.
 * Reviewed 2026-10-19. URLs are server-owned; the model only selects a concept ID.
 */
const source=(title:string,url:string)=>({publisher:'WSET',title,url});
const mouthfeel=source('The secret language of wine: what is mouthfeel?','https://www.wsetglobal.com/knowledge-centre/blog/2026/the-secret-language-of-wine-what-is-mouthfeel');
const aromatics=source('Why doesn’t wine taste like grapes?','https://www.wsetglobal.com/knowledge-centre/blog/2022/january/13/why-doesn-t-wine-taste-like-grapes');
export const STUDY_CONCEPTS:Record<string,{term:string;definition:string;source:ReturnType<typeof source>}>= {
 acidity:{term:'Acidity',definition:'Acidity stimulates saliva and contributes freshness. Notice how your mouth waters after tasting. This is a different sensation from alcohol warmth or tannic drying.',source:source('Understanding acidity in wine','https://www.wsetglobal.com/knowledge-centre/blog/2026/understanding-acidity-in-wine')},
 tannin:{term:'Tannin',definition:'Tannins interact with saliva proteins and create drying friction on gums and cheeks. Fine or smooth tannins describe the texture of that grip; drying texture is distinct from sweetness.',source:mouthfeel},
 body:{term:'Body',definition:'Body is the sensation of weight and fullness in the mouth. Alcohol, sugar and extract contribute. Describe weight separately from how strong a fruit aroma seems.',source:mouthfeel},
 bubbles:{term:'Mousse',definition:'Mousse describes the sensation of bubbles. Dissolved carbon dioxide adds a physical prickle. Assess that texture separately from the wine’s aromas and mouthwatering acidity.',source:mouthfeel},
 fruit_sweetness:{term:'Fruitiness and sweetness',definition:'Fruit descriptors concern aroma and flavour; sweetness is a taste. Smelling ripe fruit does not establish how sweet a wine tastes. Assess the two separately.',source:source('How to taste wine','https://www.wsetglobal.com/knowledge-centre/blog/2023/december/19/how-to-taste-wine/')},
 aroma:{term:'Aroma',definition:'Wine aromas come from grapes, fermentation and maturation. Fruit and flower descriptions are sensory comparisons, not a list of added ingredients. Separate the listed aromas into families before looking for finer detail.',source:aromatics},
 oak:{term:'Oak and buttery aromas',definition:'New oak can contribute vanilla aromas; malolactic conversion can contribute butter aromas. Those are distinct processes. A sensory descriptor alone does not verify which process this producer used.',source:aromatics},
 finish:{term:'Finish',definition:'Assess the persistence of pleasant flavour after tasting, separately from lingering acidity or tannic grip. A longer finish describes duration, not simply a stronger initial flavour.',source:source('Describing wines using the Wine SAT','https://www.wsetglobal.com/media/6714/wset_l4diploma_cag_tasting_en_aug2018.pdf')},
};
