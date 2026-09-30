const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try {
  const page=await browser.newPage();
  await page.route((BASE + '/sommNI/'),r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Display test</title>'}));
  await page.goto((BASE + '/sommNI/'));
  const result=await page.evaluate(async()=>{
   const P=await import('/sommNI/src/pages.ts');
   // The legacy quiz pages were replaced by the shared study engine (tests/study.glasses.cjs covers its pages).
   const pages=[P.buildFinderTypePage(),P.buildFinderVibePage(),P.buildFinderFlavorPage('Red'),P.buildFinderBodyPage(),P.buildFinderWorldPage(),P.buildCourseOverviewPage([])];
   return pages.map(pg=>{
    const boxes=[...(pg.listObject||[]),...(pg.textObject||[]),...(pg.imageObject||[])];
    const text=pg.textObject[0]; const list=pg.listObject[0];
    return {total:pg.containerTotalNum,actual:boxes.length,images:(pg.imageObject||[]).length,captures:boxes.filter(b=>b.isEventCapture===1).length,bounds:boxes.every(b=>b.xPosition>=0&&b.yPosition>=0&&b.xPosition+b.width<=576&&b.yPosition+b.height<=288),readable:text.yPosition<30&&text.height>=250,noOverlap:list.xPosition+list.width<=text.xPosition};
   });
  });
  for(const row of result){assert.equal(row.total,2);assert.equal(row.actual,2);assert.equal(row.images,0);assert.equal(row.captures,1);assert.ok(row.bounds&&row.readable&&row.noOverlap);}
  assert.equal(fs.existsSync('public/robots') ? fs.readdirSync('public/robots').length : 0,0);
  console.log(JSON.stringify({textFirstPages:result.length,noImageContainers:true,noOverlap:true,noBundledMascots:true}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
