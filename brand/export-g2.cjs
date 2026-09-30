// Export the exact production canvas without a browser or device connection.
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const ts=require('typescript'), {createCanvas,Path2D}=require('@napi-rs/canvas');
const source=fs.readFileSync(path.join(__dirname,'../src/brand-mark.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const exportsObject={};
vm.runInNewContext(compiled,{exports:exportsObject,require:name=>require(path.resolve(__dirname,'../src',name)),Path2D,document:{createElement:()=>createCanvas(190,190)}});
const canvas=exportsObject.brandGlassesCanvas(), pixels=canvas.getContext('2d').getImageData(0,0,190,190).data;
const levels=new Set();let lit=0;
for(let i=0;i<pixels.length;i+=4){levels.add(pixels[i]);if(pixels[i]>0)lit++;if(pixels[i]!==pixels[i+1]||pixels[i]!==pixels[i+2]||pixels[i]%17)throw Error('Non-quantized grayscale pixel');}
if(canvas.width!==190||canvas.height!==190||lit/(190*190)>.3)throw Error('Unexpected display dimensions or filled background');
fs.writeFileSync(path.join(__dirname,'../public/brand/g2-home-panel.png'),canvas.toBuffer('image/png'));
console.log(JSON.stringify({actualProductionPanel:'190x190',levels:[...levels].sort((a,b)=>a-b),litPixelPercent:Math.round(lit/(190*190)*100),transfer:'existing 190x95 halves'}));
