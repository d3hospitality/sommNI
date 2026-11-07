import {escape} from './client';
import type {BottleCandidate} from './bottle-jobs';
import './photo-choices.css';
export function photoChoices(options:BottleCandidate[],selected=-1){
 return `<div class="bottle-choices" role="group" aria-label="Choose a bottle photograph">${options.slice(0,3).map((photo,i)=>`<button type="button" data-photo-option="${i}" aria-pressed="${i===selected}" aria-label="Choose photo ${i+1}"><img src="${escape(photo.photo)}" alt="Bottle option ${i+1}" loading="lazy"><span>${i===selected?'✓ Selected':'Photo '+(i+1)}</span><small>${escape(photo.provenance?.vintage_binding||'Check label & vintage')}</small></button>`).join('')}</div>`;
}
