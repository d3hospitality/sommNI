type Rect={left:number;top:number;right:number;bottom:number};
type View={left:number;top:number;width:number;height:number};
/** Keep the guide in the visible phone viewport and out of the highlighted control. */
export function guidePlacement(view:View,target:Rect|null,naturalHeight:number){
 const pad=12,gap=22,width=Math.min(310,Math.max(1,view.width-pad*2));
 const left=view.left+pad,right=view.left+view.width-pad,top=view.top+pad,bottom=view.top+view.height-pad;
 const maxHeight=Math.max(1,bottom-top),height=Math.min(naturalHeight,maxHeight);
 const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(n,max));
 const center={left:view.left+(view.width-width)/2,top:top+(maxHeight-height)/2,width,maxHeight};
 if(!target||target.bottom<=top||target.top>=bottom||target.right<=left||target.left>=right)return center;
 const x=view.width<=600?center.left:clamp((target.left+target.right-width)/2,left,right-width);
 const below=bottom-target.bottom-gap,above=target.top-gap-top;
 if(below>=height)return {...center,left:x,top:target.bottom+gap};
 if(above>=height)return {...center,left:x,top:target.top-gap-height};
 // A tall globe can use the open space alongside it on a wider display.
 const y=clamp((target.top+target.bottom-height)/2,top,bottom-height);
 if(view.width>600&&right-target.right-gap>=width)return {...center,left:target.right+gap,top:y};
 if(view.width>600&&target.left-gap-left>=width)return {...center,left:target.left-gap-width,top:y};
 // Short landscape/keyboard viewports: scroll the guide instead of covering the target.
 if(Math.max(above,below)>=120){const useBelow=below>=above;return {...center,left:x,top:useBelow?target.bottom+gap:top,maxHeight:Math.max(above,below)};}
 return center;
}
