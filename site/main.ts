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
  for (const plan of ['free', 'pro'] as const) {
    const article = document.createElement('article'); article.className = 'surface-card';
    const title = document.createElement('h3'); title.textContent = plan === 'free' ? 'Free · $0' : `Pro · $${pricing.plans.monthly.amount / 100}/month or $${pricing.plans.annual.amount / 100}/year`;
    const common = document.createElement('p'); common.textContent = 'Catalog, tasting notes, Atlas, Study, manual add, your own bottle photos and wine lists from spreadsheets.';
    const list = document.createElement('ul');
    for (const feature of Object.values(pricing.features)) { const li = document.createElement('li'), n = feature[plan], label = feature.label.toLowerCase(); li.textContent = `${n} ${n === 1 ? label.replace(/s$/, '') : label} / month`; list.append(li); }
    article.append(title, common, list); pricingCards.append(article);
  }
  document.getElementById('pricing-tokens')!.textContent = 'Pro token packs: ' + Object.values(pricing.packs).map(p => `$${p.amount / 100} = ${p.units} tokens`).join(' · ');
  document.getElementById('pricing-rates')!.textContent = Object.values(pricing.features).map(f => `${f.label}: ${f.tokens} ${f.tokens === 1 ? 'token' : 'tokens'}`).join(' · ');
}
