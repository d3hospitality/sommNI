/** Catch up to the newest device context when its phone view becomes visible.
 * A visibility change alone must not undo the person's own phone browsing. */
export function createContextFollower<T>(read:()=>T|null,ready:()=>boolean,apply:(context:T)=>void){
 let applied:string|null=null;
 return()=>{const context=read();if(!context){applied=null;return false;}if(!ready())return false;
 const key=JSON.stringify(context);if(key===applied)return false;
 apply(context);applied=key;return true;};
}
