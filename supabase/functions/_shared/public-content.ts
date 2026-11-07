/** Keep audit sources in database/cache records; only sanitize the outgoing copy. */
const deliveryOrigins = new Set([
 'https://mcmtasetompygfktzhpr.supabase.co', 'https://d3hospitality.com',
 'https://sommni-api.vercel.app', 'https://sommni-beige.vercel.app', 'https://d3hospitality.github.io',
]);
export function publicContent(value: unknown, key = ''): any {
 if (key === 'search_html' || key === 'source_page' || key === 'source_image') return '';
 if (Array.isArray(value)) return value.map(item => publicContent(item));
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, publicContent(item, name)]));
 if (typeof value !== 'string' || value.startsWith('data:')) return value;
 return value.replace(/https?:\/\/[^\s<>"'\]\)]+/g, url => {
  try { return deliveryOrigins.has(new URL(url).origin) ? url : ''; } catch { return ''; }
 });
}
