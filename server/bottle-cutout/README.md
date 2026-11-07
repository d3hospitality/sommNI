# Photographic bottle cutouts

The default app path is now hosted through the dedicated Supabase project `mcmtasetompygfktzhpr`. It does not require a Python server on the owner's Mac.

## Deployed path

1. An exact catalog producer/cuvée match can reuse the existing catalog photograph, with an explicit pictured-vintage caveat.
2. For another bottle, the app uses the Supabase `bottle_lookup` action to search cited product pages, extract observed image URLs and visually check the producer, cuvée and bottle completeness. It prefers photographs at least 600 px tall, records source links and distinguishes representative vintages. A manual full-bottle upload remains available. The app normalizes it to a bounded PNG, preserving proportions.
3. `sommni-bottle-cutout` checks its private source-hash cache first. Cached cutouts do not use a new processing reservation.
4. On a cache miss, the app obtains signed model URLs from Supabase. Pinned U2NetP and non-threaded ONNX WASM assets are hash-verified and cached on the device. The compact model predicts an outline **on the user's device**; it does not generate or redraw label art.
5. Supabase validates the outline, rejects clipped/multiple/implausible silhouettes, fills opaque interiors, preserves photographic RGB, and creates a uniformly scaled 384×768 transparent PNG. Results and provenance are private in Supabase Storage.
6. A confidently matched photograph attaches automatically only while that wine still has no image; manual uploads remain explicitly reviewed. Free beta stores the selected artwork and notes in local Winebrary. The deployed `winelens-research` account endpoint stores approved artwork under the authenticated owner's private `winelens-bottles` path and returns signed URLs. Notes and concurrent edits are protected.
7. The existing `bottleCanvas` / `stageCanvas` / `toGreenLevels` renderer supplies G2 artwork.

The hosted route is `https://mcmtasetompygfktzhpr.supabase.co/functions/v1/sommni-bottle-cutout`. Gateway JWT verification stays on. The beta client uses the project's public anon JWT solely for gateway compatibility, not as a user identity. Cache tables/buckets have no direct anon/account access; the service role is server-only. The account attachment endpoint separately verifies real user authentication and ownership.

There is an isolated global beta cap of 20 new cutout attempts per UTC day, including failed attempts. Cached outputs remain available after the cap; the existing beta AI allowance is not touched. A database lease prevents duplicate finishing for a source. Source photographs are not retained by the cutter; derived PNGs and non-sensitive provenance are stored. Only fixed model URLs are fetched by the server.

The original 215 images used full U2Net. The portable hosted path uses **compact U2NetP**, so outlines can differ slightly; the photographic label, aspect ratio and app output format remain the same. Physical height is unverified. New additions automatically queue public identity details for master review, then queue transparent artwork and G2 sprites when ready. Personal notes and ratings are excluded. Persistent device jobs resume while sommNI is open and connected; uncertain photographs stay pending for retry or manual upload.

## Optional local original-model worker

For development with the original full U2Net model:

```sh
python3 server/bottle-cutout/worker.py --port 5196
```

Set `VITE_WL_BOTTLE_CUTOUT_URL=/api/bottle-cutout` explicitly to use Vite's loopback-only proxy. Compatible Python packages and the cached U2Net model are required. The production default remains Supabase.

## Validation

- `npm run typecheck` and `npm run build`
- `node tests/bottle-hosted.database.mjs`
- `deno test --allow-read --allow-net=deno.land --node-modules-dir=none tests/bottle-hosted.test.ts`
- `node tests/bottle-attachment.test.mjs`
- `qa-bottle-pipeline.html`: actual Supabase cutout, duplicate reuse, transparent PNG, local Winebrary attach/reload, note preservation, stale identity rejection, G2 raster; temporary test record removed after the check.
