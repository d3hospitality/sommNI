// DEVELOPMENT ONLY — loaded by Main.ts when `import.meta.env.DEV` and `?g2-fixture=library`.
// Lets the Even simulator exercise the glasses Winebrary without a real account or network.
// Production builds never include this module.
import type { LibraryWine } from './winebrary';
import { setLibrarySource } from './winebrary-glasses';

export function installLibraryFixture(base: string) {
  const photo = (name: string) => new URL(`photography/${name}.png`, base).href;
  const wine = (id: string, wine_name: string, extra: Partial<LibraryWine> = {}): LibraryWine => ({
    id, wine_name, producer: null, vintage: null, region: null, notes: null,
    metadata: { vintage_state: 'unknown' }, ...extra,
  });
  const items: LibraryWine[] = [
    wine('f1', 'Grand Malbec', { producer: 'Terrazas de los Andes', vintage: 2017, region: 'Mendoza', image_url: photo('red'),
      notes: 'Black fruit, fresh acidity and a generous finish. Violet and cocoa on the nose; firm, fine tannins. Opened at a friend’s birthday, still singing two hours later.',
      metadata: { vintage_state: 'year', grape: 'Malbec', color: 'Red' } }),
    wine('f2', 'Grand Malbec', { producer: 'Terrazas de los Andes', vintage: 2019, region: 'Mendoza', metadata: { vintage_state: 'year', grape: 'Malbec' } }),
    wine('f3', 'Grand Malbec', { producer: 'Terrazas de los Andes', region: 'Mendoza', metadata: { vintage_state: 'non_vintage' } }),
    wine('f4', 'Domaine de la Romanée-Conti Échezeaux Grand Cru Côte de Nuits Réserve Spéciale du Propriétaire', { vintage: 2014, region: 'Burgundy', image_url: photo('white'),
      notes: 'A deliberately long title to test wrapping. ' + 'Rose petal, forest floor, red cherry and a long saline finish. '.repeat(10),
      metadata: { vintage_state: 'year', grape: 'Pinot Noir' } }),
    wine('f5', 'Krug Grande Cuvée', { producer: 'Krug', region: 'Champagne', image_url: photo('sparkling'), metadata: { vintage_state: 'non_vintage', grape: 'Chardonnay / Pinot Noir / Meunier' } }),
    wine('f6', 'House white, no details yet'),
  ];
  for (let i = 1; i <= 22; i++) items.push(wine(`g${i}`, `Cellar test bottle ${String(i).padStart(2, '0')}`, { vintage: 2000 + i, metadata: { vintage_state: 'year' } }));
  setLibrarySource(() => ({ userId: 'fixture-user', loading: false, error: '', items }));
  console.log('[wineLENS] DEV fixture: glasses Winebrary uses 28 local sample wines');
}
