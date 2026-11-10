/** Serial checks keep release validation lightweight and reproducible on a clean checkout. */
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const tests=['native-photo-upload.test.mjs','native-photo.test.mjs','daily-preload.test.mjs','home-png.mjs','bottle-scanner.test.mjs','scan-save.test.mjs','saved-locations.test.mjs','cloud-library.test.mjs','atlas-region-glow.test.mjs','history-lifecycle.test.mjs','research-cors.test.mjs','contribution-activity-ui.test.mjs','labels.glasses.mjs','winebrary-photos.test.mjs','labels.queue.mjs','atlas-phone-handoff.test.mjs','companion-tether.test.mjs','personal-profile.database.mjs','personal-profile-ui.test.mjs','wine-origin-focus.test.mjs','master-artwork-recovery.test.mjs','sound-feedback.test.mjs','artwork-cache.test.mjs','bottle-jobs.test.mjs','bottle-discovery.test.mjs','bottle-allowance.database.mjs','bottle-allowance.test.mjs','phone-shell.test.mjs','phone-gestures.test.mjs','label-notice.test.mjs','setup-guide.test.mjs','guide-placement.test.mjs','wheel-motion.test.mjs','atlas-bottle-swipe.test.mjs','lens-mask.test.mjs','home-globe.test.mjs','photo-input.test.mjs','photo-upload-selection.test.mjs','bottle-studio.test.mjs','research.batch.mjs','menu-import.test.mjs','menu-import-ui.test.mjs','menu-batch-integration.test.mjs','contributor-profiles.database.mjs','contributor-profile-ui.test.mjs','friday-catalog.test.mjs','add-wine-session.test.mjs','add-wine-glasses.test.mjs','atlas-voice.test.mjs','scroll-bottle-preview.test.mjs'];
const bundle=new Set(['labels.queue.mjs','wine-origin-focus.test.mjs','bottle-discovery.test.mjs','bottle-allowance.test.mjs','wheel-motion.test.mjs','atlas-bottle-swipe.test.mjs','menu-import.test.mjs','atlas-voice.test.mjs','add-wine-session.test.mjs']);
const temp=await mkdtemp(join(tmpdir(),'sommni-beta-checks-'));
const failed=[];
for(const test of tests){
 let path='tests/'+test;
 if(bundle.has(test)){const out=join(temp,test);await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',alias:{'npm:htmlparser2@10.1.0':'htmlparser2'},loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/sommNI/"'},outfile:out});path=out;}
 const result=spawnSync(process.execPath,['--no-warnings',path],{stdio:'inherit'});
 console.log(`${result.status===0?'PASS':'FAIL'} ${test}`);
 if(result.status!==0)failed.push(test);
}
if(failed.length){console.error('Failed:',failed);process.exitCode=1;}
else console.log(`All ${tests.length} beta checks passed.`);
