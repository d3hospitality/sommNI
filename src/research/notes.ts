import { downloadNotes } from './client';
export function mountWineNotesExport(host:HTMLElement,wine:any) {
 host.innerHTML='<p class="wl-kicker">TASTING NOTES, TO KEEP</p><button type="button" class="wl-outline" data-notes>Download notes ↓</button>';
 host.querySelector('[data-notes]')!.addEventListener('click',()=>downloadNotes(wine));
}
