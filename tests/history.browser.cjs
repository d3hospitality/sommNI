// The same fixtures can be opened directly for CUA or manual browser verification.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const origin=process.env.WINELENS_TEST_ORIGIN||'http://127.0.0.1:5188';
  for(const fixture of ['qa-stories.html','qa-reading-detail.html']){
   const page=await browser.newPage();
   await page.goto(origin+'/sommNI/'+fixture);
   await page.waitForFunction(()=>document.documentElement.dataset.complete==='true');
   const result=JSON.parse(await page.locator('#result').textContent());
   assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.wines,215);assert.ok(result.passed>0);
   console.log(fixture,result.passed,'checks passed');await page.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
