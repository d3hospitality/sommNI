/** Keep the embedded phone UI at its designed scale; regular browsers retain zoom. */
export function initPhoneGestures(){
 const host=window as unknown as {flutter_inappwebview?:{callHandler?:unknown}};
 if(typeof host.flutter_inappwebview?.callHandler!=='function'||document.documentElement.classList.contains('even-phone-gestures'))return;
 document.documentElement.classList.add('even-phone-gestures');
 const viewport=document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
 if(viewport)viewport.content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
 const preventPinch=(event:TouchEvent)=>{if(event.touches.length>1&&event.cancelable)event.preventDefault();};
 document.addEventListener('touchstart',preventPinch,{passive:false});
 document.addEventListener('touchmove',preventPinch,{passive:false});
 document.addEventListener('gesturestart',event=>{if(event.cancelable)event.preventDefault();},{passive:false});
}
