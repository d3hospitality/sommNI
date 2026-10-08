import pricing from '../shared/rate-card.json';
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.getElementById('nav-links');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open)); nav?.classList.toggle('open', open);
});
nav?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('a')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav?.classList.contains('open')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); toggle?.focus(); } });

const pricingCards = document.getElementById('pricing-cards');
if (pricingCards) {
  const card = (title: string, body: string, items: string[]) => {
    const article = document.createElement('article'); article.className = 'surface-card';
    const h = document.createElement('h3'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = body;
    const list = document.createElement('ul'); for (const text of items) { const li = document.createElement('li'); li.textContent = text; list.append(li); }
    article.append(h, p, list); pricingCards.append(article);
  };
  const f = pricing.features, month = (k: keyof typeof f, plan: 'free' | 'pro') => `${f[k][plan]} ${f[k].label.toLowerCase()} a month`;
  card('Free preview · $0', 'The 215-wine catalog with tasting notes, the Wine Atlas, Study, Find My Wine and your own wines typed in by hand.',
    [month('label_scan', 'free'), month('tasting_notes', 'free'), month('wine_list_page', 'free'), month('sommelier', 'free'), 'Wine cards need the app']);
  card(`wineLENS · $${(pricing.app.amount / 100).toFixed(2)} once`, `Yours for life, no subscription. Includes ${pricing.app.tokens} tokens: your first ${pricing.app.tokens} wine cards.`,
    [month('label_scan', 'pro'), month('tasting_notes', 'pro'), month('wine_list_page', 'pro'), month('wine_list_text', 'pro'), month('sommelier', 'pro'), 'Wine cards: 1 token each']);
  document.getElementById('pricing-tokens')!.textContent = 'Token packs: ' + Object.values(pricing.packs).map(p => `$${p.amount / 100} = ${p.units} tokens`).join(' · ') + '. A 100-wine list is $20.';
  document.getElementById('pricing-rates')!.textContent = '1 token = 1 wine card (3D bottle image, tasting notes, the year and a map pin), every time. Tokens never expire.';
}
