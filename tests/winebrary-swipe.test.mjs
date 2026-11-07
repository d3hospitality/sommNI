import assert from 'node:assert/strict';
import {bindWinebrarySwipe} from '../src/winebrary-swipe.ts';
// Isolated event fixture: no browser or user data.
class Element {
 listeners={}; attrs={}; properties={}; children={}; open=true; inert=true;
 constructor(){const classes=new Set();this.classList={contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,v)=>v?classes.add(k):classes.delete(k)};this.style={setProperty:(k,v)=>this.properties[k]=v,removeProperty:k=>delete this.properties[k]};}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 querySelector(k){return this.children[k]} setAttribute(k,v){this.attrs[k]=v} focus(){this.focused=true}
 closest(){return this.interactive?this:null} setPointerCapture(id){this.captured=id}
 fire(type,values={}){const e={type,button:0,pointerId:1,clientX:150,clientY:100,target:this,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...values};for(const fn of this.listeners[type]??[])fn(e);return e;}
}
const rows=Array.from({length:2},()=>{const row=new Element();for(const k of ['.wl-swipe-content','.wl-swipe-dock','details','[data-row-actions]','[data-close-actions]'])row.children[k]=new Element();return row});
bindWinebrarySwipe({querySelectorAll:()=>rows});
const [a,b]=rows,s=a.children['.wl-swipe-content'],dock=a.children['.wl-swipe-dock'];
const open=r=>r.classList.contains('actions-open');
s.fire('pointerdown');s.fire('pointermove',{clientX:145,clientY:150});s.fire('pointerup');assert.equal(open(a),false,'Vertical scrolling never reveals destructive actions');
s.fire('pointerdown');s.fire('pointermove',{clientX:80});s.fire('pointerup');assert.equal(open(a),true);assert.equal(dock.inert,false);assert.equal(a.children.details.open,false);assert.equal(s.fire('click').prevented,true,'Swipe cannot also open notes');
a.fire('keydown',{key:'Escape'});assert.equal(open(a),false);assert.equal(dock.inert,true);assert.equal(a.children['[data-row-actions]'].focused,true);
s.fire('pointerdown');s.fire('pointermove',{clientX:70});s.fire('pointercancel');assert.equal(open(a),false,'OS cancellation restores closed state');
a.children['[data-row-actions]'].fire('click');b.children['[data-row-actions]'].fire('click');assert.equal(open(a),false);assert.equal(open(b),true,'Only one action dock opens');
a.children['[data-row-actions]'].fire('click');s.fire('pointerdown');s.fire('pointermove',{clientX:220});s.fire('pointerup');assert.equal(open(a),false,'Swipe right closes');
s.interactive=true;s.fire('pointerdown');s.fire('pointermove',{clientX:50});s.fire('pointerup');assert.equal(open(a),false,'Inputs and buttons do not initiate swipe');
console.log('PASS: swipe intent, vertical scroll, cancellation, click suppression, Escape, one open row, right-swipe close, interactive exclusion.');
