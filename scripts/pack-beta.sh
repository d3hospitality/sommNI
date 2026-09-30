#!/bin/sh
# Beta package for Even Hub: same package id, name "wineLENS Beta", version from app.beta.json.
# Built with a relative base (the web build uses /sommNI/ for GitHub Pages).
# Produces wineLENS-<version>-beta.ehpk. Uploading to Even Hub is a manual step.
set -e
VERSION=$(node -p "require('./app.beta.json').version")
npx vite build --base ./ --outDir dist-ehpk --emptyOutDir
rm -f dist-ehpk/bottle-review.html            # internal review tool, not part of the app
evenhub pack app.beta.json dist-ehpk -o "wineLENS-$VERSION-beta.ehpk"
ls -lh "wineLENS-$VERSION-beta.ehpk"
