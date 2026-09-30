// Build-time only. NODE_PATH must resolve fontkit@2.0.4 and sharp.
// Node: NODE_PATH=/path/to/asset-tool/node_modules node brand/build.cjs
const fs=require('node:fs'), path=require('node:path');
const fontkit=require('fontkit'), sharp=require('sharp');
const root=path.resolve(__dirname,'..'), out=path.join(root,'public/brand');
const identity=require('./identity.json'), c=identity.colors;
fs.mkdirSync(out,{recursive:true});
const svg=(w,h,body,title='wineLENS')=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${title}</title>${body}</svg>`;
function mark(color,small=false){const p=small?identity.micro:identity.mark;return `<g fill="none" stroke="${color}" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${p.frame}"/><path d="${p.glass}"/></g><path fill="${color}" d="${p.wine}"/>`;}
const regular=fontkit.openSync(path.join(__dirname,'fonts/space-grotesk-400.ttf'));
const bold=fontkit.openSync(path.join(__dirname,'fonts/space-grotesk-700.ttf'));
let cursor=0;const outlines=[];
for(const [font,text] of [[regular,'wine'],[bold,'LENS']]){
 const run=font.layout(text), scale=100/font.unitsPerEm;
 for(let i=0;i<run.glyphs.length;i++){
  const pos=run.positions[i];outlines.push(run.glyphs[i].path.transform(scale,0,0,-scale,cursor+pos.xOffset*scale,100-pos.yOffset*scale));
  cursor+=pos.xAdvance*scale;
 }
}
const boxes=outlines.map(p=>p.bbox);
const x=Math.min(...boxes.map(b=>b.minX)), y=Math.min(...boxes.map(b=>b.minY));
const width=Math.max(...boxes.map(b=>b.maxX))-x, height=Math.max(...boxes.map(b=>b.maxY))-y;
const paths=outlines.map(p=>p.toSVG());
if(paths.some(p=>/NaN|undefined/.test(p)))throw Error('Invalid font outlines');
const word=(color)=>`<g fill="${color}" transform="translate(${-x} ${-y})">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
fs.writeFileSync(path.join(__dirname,'wordmark.json'),JSON.stringify({x,y,width,height,paths})+'\n');
const assets={
 'symbol.svg':svg(128,128,mark(c.oxblood),'wineLENS Focus Pour'),
 'symbol-ink.svg':svg(128,128,mark(c.ink)),
 'symbol-reverse.svg':svg(128,128,mark(c.ivory)),
 'symbol-mono.svg':svg(128,128,mark('#000000')),
 'symbol-white.svg':svg(128,128,mark('#FFFFFF')),
 'micro.svg':svg(32,32,mark(c.oxblood,true)),
 'micro-white.svg':svg(32,32,mark('#FFFFFF',true)),
 'favicon.svg':svg(40,40,`<rect width="40" height="40" rx="10" fill="${c.ivory}"/><g transform="translate(4 4)">${mark(c.oxblood,true)}</g>`),
 'wordmark.svg':svg(width,height,word(c.ink)),
 'wordmark-reverse.svg':svg(width,height,word(c.ivory)),
 'lockup.svg':svg(154+width*0.95,128,mark(c.oxblood)+`<g transform="translate(154 ${(128-height*.95)/2}) scale(.95)">${word(c.ink)}</g>`),
 'lockup-reverse.svg':svg(154+width*.95,128,mark(c.ivory)+`<g transform="translate(154 ${(128-height*.95)/2}) scale(.95)">${word(c.ivory)}</g>`),
 'app-icon.svg':svg(1024,1024,`<rect width="1024" height="1024" rx="224" fill="${c.oxblood}"/><g transform="translate(192 192) scale(5)">${mark(c.ivory)}</g>`),
 'maskable.svg':svg(1024,1024,`<rect width="1024" height="1024" fill="${c.oxblood}"/><g transform="translate(192 192) scale(5)">${mark(c.ivory)}</g>`),
 'oauth-logo.svg':svg(120,120,`<rect width="120" height="120" fill="${c.ivory}"/><g transform="translate(12 12) scale(.75)">${mark(c.oxblood)}</g>`),
 'social-card.svg':svg(1200,630,`<rect width="1200" height="630" fill="${c.ivory}"/><rect x="865" width="335" height="630" fill="${c.blush}"/><path d="M56 502H809" stroke="#D9CCC1"/><g transform="translate(916 196) scale(1.85)">${mark(c.oxblood)}</g><g transform="translate(66 86) scale(1.4)">${word(c.ink)}</g><text x="63" y="310" font-family="sans-serif" font-size="64" fill="${c.oxblood}">Wine. In. Focus.</text><text x="66" y="373" font-family="sans-serif" font-size="26" fill="${c.ink}">Discover. Collect. Remember.</text><text x="66" y="555" font-family="sans-serif" font-size="18" letter-spacing="3" fill="${c.ink}">MADE FOR EVEN G2 · BY D3 HOSPITALITY</text>`)
};
(async()=>{
 for(const [name,value] of Object.entries(assets))fs.writeFileSync(path.join(out,name),value+'\n');
 for(const n of [16,32,48])await sharp(Buffer.from(assets['favicon.svg'])).resize(n,n).png().toFile(path.join(out,`favicon-${n}.png`));
 for(const n of [180,192,512,1024])await sharp(Buffer.from(assets['app-icon.svg'])).resize(n,n).png().toFile(path.join(out,`app-icon-${n}.png`));
 for(const n of [192,512])await sharp(Buffer.from(assets['maskable.svg'])).resize(n,n).png().toFile(path.join(out,`maskable-${n}.png`));
 await sharp(Buffer.from(assets['oauth-logo.svg'])).png().toFile(path.join(out,'oauth-logo-120.png'));
 await sharp(Buffer.from(assets['social-card.svg'])).png().toFile(path.join(out,'social-card.png'));
 await sharp(Buffer.from(assets['symbol.svg'])).resize(512).png().toFile(path.join(out,'symbol-512.png'));
 // Native monochrome exports: alpha is flattened to black, then 16 levels.
 for(const size of [24,32,48,128]){
  const source=size<=32?assets['micro-white.svg']:assets['symbol-white.svg'];
  const raw=await sharp(Buffer.from(source)).resize(size,size).flatten({background:'#000'}).greyscale().raw().toBuffer();
  for(let i=0;i<raw.length;i++)raw[i]=Math.round(raw[i]/17)*17;
  await sharp(raw,{raw:{width:size,height:size,channels:1}}).png().toFile(path.join(out,`g2-mark-${size}.png`));
 }
 console.log(`Built ${Object.keys(assets).length} SVG masters and raster exports in public/brand`);
})().catch(e=>{console.error(e);process.exitCode=1});
