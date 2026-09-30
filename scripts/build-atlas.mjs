import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({entryPoints:[path.join(root,'src/atlas/demo.ts')],outfile:path.join(root,'public/atlas/demo.js'),bundle:true,format:'esm',minify:true,legalComments:'eof'});
console.log('Built standalone Atlas preview. Vite copies public/atlas into dist.');
