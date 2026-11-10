/** Separate visual evidence from researched facts; geometry is optional and never an identity signal. */
const string={type:'string'};
export function wineSchema(identify:boolean){
 const properties:Record<string,unknown>={wine_name:string,producer:string,vintage:{type:['integer','null']},vintage_state:{type:'string',enum:['year','non_vintage','unknown']},region:string,country:string,grape:string,color:{type:'string',enum:['','Red','White','Sparkling','Rosé','Orange','Dessert','Sake']},sake_classification:string,sake_style:string,rice_variety:string,tasting_notes:string,uncertainty:string};
 if(identify)properties.bottle_outline={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['top','bottom','left','right'],properties:{top:{type:'number'},bottom:{type:'number'},left:{type:'array',items:{type:'number'},minItems:12,maxItems:12},right:{type:'array',items:{type:'number'},minItems:12,maxItems:12}}}]};
 return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
export type PhotoOutline={top:number;bottom:number;left:number[];right:number[]};
/** Reject malformed, out-of-image and implausible geometry; it must never prevent label recognition. */
export function photoOutline(value:unknown):PhotoOutline|null{
 const v=value as PhotoOutline;
 if(!v||!Number.isFinite(v.top)||!Number.isFinite(v.bottom)||v.top<0||v.bottom>1||v.bottom-v.top<.15)return null;
 if(!Array.isArray(v.left)||!Array.isArray(v.right)||v.left.length!==12||v.right.length!==12)return null;
 for(let i=0;i<12;i++)if(!Number.isFinite(v.left[i])||!Number.isFinite(v.right[i])||v.left[i]<0||v.right[i]>1||v.right[i]-v.left[i]<.008||v.right[i]-v.left[i]>.9)return null;
 return {top:v.top,bottom:v.bottom,left:[...v.left],right:[...v.right]};
}
