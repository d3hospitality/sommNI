const { chromium } = require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const origin=process.env.WINELENS_TEST_ORIGIN||'http://127.0.0.1:5196',base=process.env.WINELENS_TEST_PATH||'/sommNI/';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 await page.goto(origin+base);await page.locator('#depth-map-status').filter({hasText:'Argentina highlighted'}).waitFor();
 const globalSearch=page.locator('#wine-search-input');
 await globalSearch.fill('Barolo');await globalSearch.press('Enter');
 assert.equal(await page.locator('#notes-search').inputValue(),'Barolo');assert((await page.locator('.notes-result').count())>0);
 await page.locator('[data-notes-close]').click();
 await page.locator('#depth-notes').click();const notes=page.locator('#wine-notes-dialog');
 assert.match(await notes.innerText(),/Ripe blackberry/);assert.equal(await notes.locator('.notes-sections section').count(),5);
 const download=page.waitForEvent('download');await page.locator('#notes-download').click();const file=await download;assert.match(file.suggestedFilename(),/tasting-notes.txt$/);assert.match(fs.readFileSync(await file.path(),'utf8'),/Palate/);
 await page.locator('[data-notes-close]').click();await page.locator('.depth-under [data-browse-notes]').click();assert.equal(await page.locator('.notes-result').count(),215);
 await page.locator('#notes-search').fill('Margaux');assert((await page.locator('.notes-result').count())>0);await page.locator('.notes-result').first().click();assert.match(await notes.innerText(),/Margaux/);await page.locator('[data-notes-close]').click();
 await page.locator('#dot-explore').click();const globe=page.locator('#dot-explorer');await page.waitForFunction(()=>document.querySelector('#dot-explorer')?.dataset.zoom==='1.000');
 assert.equal(await globe.getAttribute('data-country'),'ARG');
 const placeSearch=page.locator('#orbit-search-input');await placeSearch.fill('Piemonte');
 await page.locator('#orbit-search-results button').filter({hasText:'Piedmont'}).click();
 await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='IT-21');
 assert.equal(await page.locator('#dot-region').innerText(),'Piedmont (Piemonte)');
 await placeSearch.fill('nothingmatcheszz');assert.match(await page.locator('#orbit-search-status').innerText(),/No matching place/);
 await placeSearch.press('Escape');assert.equal(await placeSearch.inputValue(),'');assert(await page.locator('#dot-dialog').evaluate(d=>d.open));
 await placeSearch.fill('Mendoza');await placeSearch.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='ARG-1275');
 await page.locator('#orbit-world').click();await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.zoom==='1.000');

 const box=await globe.boundingBox(),lon=await globe.getAttribute('data-longitude');
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8});await page.mouse.up();await page.waitForFunction(l=>document.querySelector('#dot-explorer').dataset.longitude!==l,lon);assert.equal(await globe.getAttribute('data-country'),'ARG','drag does not select');
 await globe.press('ArrowRight');const before=+(await globe.getAttribute('data-zoom'));await page.mouse.wheel(0,-100);await page.waitForFunction(z=>+document.querySelector('#dot-explorer').dataset.zoom>z,before);
 await page.locator('#orbit-world').click();await page.locator('#orbit-spin').click();const spinLon=await globe.getAttribute('data-longitude');await page.waitForFunction(l=>document.querySelector('#dot-explorer').dataset.longitude!==l,spinLon);await page.locator('#orbit-spin').click();assert.equal(await page.locator('#orbit-spin').getAttribute('aria-pressed'),'false');
 // Known geographic coordinate -> visible sphere projection -> actual pointer click.
 async function clickGeo(lon,lat){const state=await globe.evaluate(e=>({lon:+e.dataset.longitude,lat:+e.dataset.latitude,zoom:+e.dataset.zoom}));const b=await globe.boundingBox(),d=Math.PI/180,dl=(lon-state.lon)*d,p=lat*d,c=state.lat*d,r=280*state.zoom;const x=360+r*Math.cos(p)*Math.sin(dl),y=360-r*(Math.sin(p)*Math.cos(c)-Math.cos(p)*Math.cos(dl)*Math.sin(c));await page.mouse.click(b.x+x/720*b.width,b.y+y/720*b.height);}
 await page.locator('#orbit-country').selectOption('ARG');await page.locator('#orbit-world').click();await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.zoom==='1.000');
 await clickGeo(-51,-15);await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.country==='BRA');assert.equal(await page.locator('#orbit-country').inputValue(),'BRA');
 await page.locator('#orbit-country').selectOption('FRA');await page.locator('#orbit-region').selectOption('FRA-5295');await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='FRA-5295');assert.match(await page.locator('#orbit-info').innerText(),/Gironde/);assert.match(await page.locator('#orbit-info').innerText(),/Margaux/);
 await page.screenshot({path:'../globe-gironde.png'});
 // Regression: Italy must expose parent regions, not only provinces such as Cuneo.
 await page.locator('#orbit-country').selectOption('ITA');
 assert.equal(await page.locator('#orbit-region option').count(),21,'20 Italian regions plus placeholder');
 await page.locator('#orbit-region').selectOption('IT-21');
 await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='IT-21');
 assert.equal(await page.locator('#dot-region').innerText(),'Piedmont (Piemonte)');
 assert.match(await page.locator('#orbit-info').innerText(),/Barolo/);
 await page.locator('.orbit-wines [data-wine-notes]').filter({hasText:'Barolo'}).first().click();
 assert.match(await notes.innerText(),/Nebbiolo/);await page.locator('[data-notes-close]').click();
 await page.locator('#orbit-country').selectOption('ITA');
 await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='');
 await clickGeo(7.94,44.61);await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='IT-21');
 await page.screenshot({path:'../globe-piedmont.png'});
 await page.locator('#orbit-country').selectOption('ARG');await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.country==='ARG');await clickGeo(-68.5,-34.5);await page.waitForFunction(()=>document.querySelector('#dot-explorer').dataset.boundary==='ARG-1275');assert.equal(await page.locator('#dot-region').innerText(),'Mendoza');
 await page.locator('.orbit-wines [data-wine-notes]').first().click();assert.match(await notes.innerText(),/Grand Malbec/);await page.locator('[data-notes-close]').click();assert.equal(await page.locator('#dot-dialog').evaluate(d=>d.open),true);
 // Touch pinch uses the same pointer handlers in the browser without a physical device.
 const rect=await globe.boundingBox();const coords={y:rect.y+rect.height/2,left:rect.x+rect.width*.35,right:rect.x+rect.width*.65};const zoom=+(await globe.getAttribute('data-zoom'));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:coords.left,y:coords.y,id:1},{x:coords.right,y:coords.y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:coords.left-20,y:coords.y,id:1},{x:coords.right+20,y:coords.y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(z=>+document.querySelector('#dot-explorer').dataset.zoom>z,zoom);
 await page.locator('#dot-close').click();
 for(const width of [320,390,760,1024]){await page.setViewportSize({width,height:900});await page.locator('#dot-explore').click();await globe.waitFor();assert(await page.locator('#dot-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),`atlas fits ${width}`);await page.locator('#dot-close').click();await page.locator('#depth-notes').click();assert(await notes.evaluate(e=>e.scrollWidth<=e.clientWidth),`notes fit ${width}`);await page.locator('[data-notes-close]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page fits ${width}`);}
 await page.setViewportSize({width:1440,height:1100});await page.getByRole('button',{name:'Discover',exact:true}).click();await page.locator('[data-action=cellar-type]').first().click();await page.locator('[data-action=cellar-country]').first().click();await page.locator('[data-action=cellar-grape]').first().click();await page.locator('[data-wine-notes]').filter({visible:true}).first().click();assert(await notes.isVisible());await notes.locator('[data-save-library]').click();await page.locator('#wl-wine-form').waitFor();assert.equal(await notes.evaluate(d=>d.open),false);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('link',{name:'Explore the 3D globe'}).click();await globe.waitFor();assert(await page.locator('#dot-dialog').evaluate(d=>d.open));await page.locator('#dot-close').click();assert.deepEqual(errors,[]);
 fs.writeFileSync('../globe-validation.json',JSON.stringify({result:'passed',catalogWines:215,checks:['prominent global wine search','atlas country and region search including Piemonte alias and keyboard selection','home notes','search notes','notes text download','drag rotation','keyboard rotation','wheel zoom','spin pause','country pointer selection','region border pointer selection','region dropdown and linked wines','Italian parent regions and Piedmont pointer selection with Barolo notes','nested notes dialog','touch pinch','320/390/760/1024 layout','Discover notes and save','Discover globe'],pageErrors:errors},null,2));console.log('Globe and tasting notes browser checks passed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
