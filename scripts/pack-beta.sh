#!/bin/sh
# Beta package for Even Hub: same package id, name "sommNI Beta", version from app.beta.json.
# Built with a relative base (the web build uses /sommNI/ for GitHub Pages).
# Produces sommNI-<version>-beta.ehpk. Upload and beta promotion use the Even Hub CLI.
set -e
VERSION=$(node -p "require('./app.beta.json').version")
VITE_WL_FREE_BETA=true npx vite build --base ./ --outDir dist-ehpk --emptyOutDir
rm -f dist-ehpk/bottle-review.html dist-ehpk/account.html            # internal review tool, not part of the app
rm -rf dist-ehpk/store                                         # native marketing screenshots
node scripts/client-url-audit.mjs dist-ehpk
npx --yes @evenrealities/evenhub-cli@0.2.0 pack app.beta.json dist-ehpk --sdk-ver "$(node -p 'require("./node_modules/@evenrealities/even_hub_sdk/package.json").version')" -o "sommNI-$VERSION-beta.ehpk"
ls -lh "sommNI-$VERSION-beta.ehpk"
