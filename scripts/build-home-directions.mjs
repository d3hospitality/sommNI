import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const destination=resolve(process.argv[2]||'../../outputs/sommNI-home-in-motion');
const [{outputFiles},html,css]=await Promise.all([
 build({entryPoints:['src/home-directions/studio.ts'],bundle:true,format:'iife',target:'es2020',minify:true,write:false}),
 readFile('home-directions.html','utf8'),readFile('src/home-directions/studio.css','utf8'),
]);
const script=outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const standalone=html.replace('<link rel="stylesheet" href="./src/home-directions/studio.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="./src/home-directions/studio.ts"></script>',()=>`<script>${script}</script>`);
await mkdir(destination,{recursive:true});await writeFile(resolve(destination,'sommNI-home-in-motion.html'),standalone);
console.log(JSON.stringify({file:resolve(destination,'sommNI-home-in-motion.html'),bytes:Buffer.byteLength(standalone),networkDependencies:0}));
