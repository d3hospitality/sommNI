const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
// Phone study flow in the real app: sourced card → attempt → reveal with source →
// one persisted review → correct next due date (next day, with a fixed clock).
// Needs the dev server on http://localhost:5186/sommNI/ (npm run dev).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const output=process.env.WINELENS_TEST_OUTPUT||require('os').tmpdir()+'/winelens-study-tests';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // No account: the guest log stays on this device. No network API is reached.
  await page.route('**/api/**',r=>r.fulfill({status:404,json:{error:'not in this test'}}));
  await page.clock.setFixedTime(new Date('2026-10-01T09:00:00Z'));
  await page.goto((BASE + '/sommNI/'));
  const study=()=>page.locator('#study-content');
  await page.getByRole('button',{name:'Study',exact:true}).click();
  await study().getByRole('heading',{name:'5 cards ready'}).waitFor();
  await study().getByRole('button',{name:/^Start · 5 cards/}).click();

  // Card 1: Cain NV14 — typed attempt, reveal, source, rating.
  await study().getByRole('heading',{name:'Cain Cuvée NV14'}).waitFor();
  assert.equal(await study().getByText('48% 2013').count(),0,'no answer before reveal');
  await study().getByLabel(/Your answer/).fill('2013 and 2014 I think');
  await study().getByRole('button',{name:'Reveal answer'}).click();
  await study().getByText('Your answer matches the reference.').waitFor();
  await study().getByText('48% 2013 and 52% 2014',{exact:true}).waitFor();
  const source=study().getByRole('link',{name:'Cain Vineyard & Winery'});
  assert.equal(await source.getAttribute('href'),'https://www.cainfive.com/wp-content/uploads/2021/08/NV14_Cain_Cuvee_factsheet.pdf');
  const good=study().getByRole('button',{name:/^Good/});
  assert.match(await good.innerText(),/Next: tomorrow/);
  await page.screenshot({path:path.join(output,'wineLENS-Study-Reveal-390.png'),fullPage:false});
  await good.dblclick();                                    // fast double tap
  await study().getByText('Saved.',{exact:true}).waitFor();
  const events1=await page.evaluate(()=>JSON.parse(localStorage.getItem('winelens_study_v1:guest')).events);
  assert.equal(events1.length,1,'exactly one review for the presentation');
  assert.equal(events1[0].rating,'good');assert.equal(events1[0].card_id,'card_cain-nv14_blend-years');assert.equal(events1[0].correct,true);

  // Remaining cards: reveal without typing, rate Good. Pater Patriae shows no label.
  for(let i=2;i<=5;i++){
   await study().getByRole('button',{name:/Next card|Finish/}).click();
   await study().getByText(`CARD ${i} OF 5`,{exact:false}).waitFor();
   if(await study().getByRole('heading',{name:/Pater Patriae/}).count()) assert.equal(await study().locator('img.st-bottle').count(),0,'label hidden for Pater Patriae');
   await study().getByRole('button',{name:'Reveal answer'}).click();
   await study().getByRole('button',{name:/^Good/}).click();
   await study().getByText('Saved.',{exact:true}).waitFor();
  }
  await study().getByRole('button',{name:/Finish/}).click();
  await study().getByRole('heading',{name:'5 reviews saved'}).waitFor();
  await study().getByText('tomorrow',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'wineLENS-Study-Summary-390.png'),fullPage:true});
  await study().getByRole('button',{name:'Done'}).click();

  // Same day after reload: nothing due, progress persisted.
  await page.reload();
  await page.getByRole('button',{name:'Study',exact:true}).click();
  await study().getByRole('heading',{name:'Nothing due right now'}).waitFor();
  await study().getByText('Next review tomorrow.',{exact:false}).waitFor();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('winelens_study_v1:guest')));
  assert.equal(stored.events.length,5);assert.equal(stored.owner,'guest');

  // Next day: all five cards are due again.
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
  await page.reload();
  await page.getByRole('button',{name:'Study',exact:true}).click();
  await study().getByRole('heading',{name:'5 cards ready'}).waitFor();
  const dueCounts=await study().locator('.st-stats dd').allInnerTexts();
  await page.screenshot({path:path.join(output,'wineLENS-Study-NextDay-390.png'),fullPage:true});

  // Wines: search finds the wine, and its notes page shows the reference status.
  await page.getByRole('button',{name:'Wines',exact:true}).click();
  await page.locator('#cat-search').fill('Cain Cuvée');
  await page.locator('[data-cat-open]',{hasText:'Cain Cuvée'}).first().click();
  const chip=await page.locator('dialog[open] .ref-chip').innerText();
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({dueCounts,chip,errors}));
  assert.deepEqual(errors,[]);
  assert.deepEqual(dueCounts,['5','0','0','0']);
  assert.match(chip,/Producer-sourced facts · Cain Vineyard & Winery/);
  console.log('phone study: all checks passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
