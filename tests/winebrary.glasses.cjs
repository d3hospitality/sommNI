const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),headless:true});
 const page=await browser.newPage();await page.goto((BASE + '/sommNI/'));
 const result=await page.evaluate(async()=>{
  const g=await import('/sommNI/src/winebrary-glasses.ts');
  const raster=await import('/sommNI/src/bottle-raster.ts');const images=await import('/sommNI/src/image-utils.ts');
  const wine={id:'w-private',wine_name:'A long wine title that spans more than one line without hiding the vintage',vintage:2017,producer:'Producer',region:'Mendoza',notes:'Fruit and freshness. '.repeat(20),metadata:{vintage_state:'year'},image_url:location.origin+'/sommNI/photography/red.png'};
  const schema=g.buildLibraryWinePage(wine);
  const boxes=[...schema.textObject,...schema.imageObject];
  const bounds=boxes.every(b=>b.xPosition>=0&&b.yPosition>=0&&b.xPosition+b.width<=576&&b.yPosition+b.height<=288);
  const capture=boxes.filter(b=>b.isEventCapture===1).length;
  const pix=new Uint8ClampedArray(4*4*4);pix[(1*4+2)*4+3]=255;const alpha=raster.alphaBounds(pix,4,4);
  const canvas=await raster.bottleCanvas(location.origin+'/sommNI/photography/sparkling.png',100,280);
  const gray=raster.toGreenLevels(canvas.getContext('2d').getImageData(0,0,100,280).data);
  let minY=280,maxY=-1;for(let y=0;y<280;y++)for(let x=0;x<100;x++)if(gray[y*100+x]>0){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  let reject=true,active=0,maxActive=0,updates=[];
  const bridge={rebuildPageContainer:async()=>!reject,updateImageRawData:async(data)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));updates.push(data);active--;return 'success';}};
  g.connectWinebraryGlasses(bridge,location.origin+'/sommNI/');g.setWinebraryDeviceConnected(true);
  let rejection=false;try{await g.showWineOnGlasses(wine);}catch{rejection=true;}
  const inactiveAfterReject=!g.handleLibraryGlassesEvent({sysEvent:{eventType:0}});
  reject=false;await g.showWineOnGlasses(wine);
  const dims=updates.map(u=>{const b=new Uint8Array(u.imageData);const v=new DataView(b.buffer);return [v.getUint32(16),v.getUint32(20)];});
  updates=[];const stale=images.pushBottlePhoto(bridge,wine.image_url,100,120);images.invalidateImages();await stale;const staleCount=updates.length;
  updates=[];await Promise.all([images.pushBottlePhoto(bridge,wine.image_url,100,120),images.pushBottlePhoto(bridge,wine.image_url,100,120)]);
  await g.clearPrivateGlasses();const cleared=!g.handleLibraryGlassesEvent({sysEvent:{eventType:0}});
  return {bounds,capture,alpha,levels:[...gray].every(v=>v%17===0),bottleHeight:maxY-minY+1,rejection,inactiveAfterReject,dims,staleCount,maxActive,cleared};
 });
 assert.equal(result.bounds,true);assert.equal(result.capture,1);assert.deepEqual(result.alpha,{x:2,y:1,width:1,height:1});assert.ok(result.bottleHeight>250);assert.equal(result.levels,true);assert.equal(result.rejection,true);assert.equal(result.inactiveAfterReject,true);assert.deepEqual(result.dims,[[100,120],[100,120]]);assert.equal(result.staleCount,0);assert.equal(result.maxActive,1);assert.equal(result.cleared,true);
 console.log(JSON.stringify(result));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
