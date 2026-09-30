# Vendored: G2B showcase

`showcase.ts`, `timeline.ts`, `showcase.css`, `stage.ts` and `types.ts` are copied unchanged from the PolyGot site
(`lingua-franca/site/g2b`, itself synced from `g2b-showcase` at 2ff266e). Change them upstream and copy again, so
wineLENS, PolyGot and TEMPO draw the same showcase. wineLENS's own settings live in `site/public/g2b/winelens.json`;
posters, fallback videos and the page's lens stills are rendered from the live page by `tools/render-showcase.cjs`.
