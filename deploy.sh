#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════════════════════
# sommNI — One-Button Deploy
# Seven Second Sommelier for Even Realities G2
# ════════════════════════════════════════════════════════════════════════════

# ── Configuration ──
PROJECT="$HOME/sommni"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXCEL_FILE="$HOME/Desktop/sommNI 2/02.17.26 - Wine Tasting Notes - ソムニ sommNI Final.xlsx"
LOGO="$HOME/Desktop/sommNI/sommNI Logo.png"

echo ""
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║  sommNI — Seven Second Sommelier                               ║"
echo "  ║  Deploy Pipeline                                               ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo ""

# ── Kill existing dev server ──
pkill -f "vite" 2>/dev/null || true
sleep 1

# ── Clean slate ──
rm -rf "$PROJECT"
mkdir -p "$PROJECT/src" "$PROJECT/scripts" "$PROJECT/assets"

# ── Copy scripts ──
cp "$SCRIPT_DIR/scripts/generate_constants.py" "$PROJECT/scripts/"

# ── Generate constants.ts from Excel ──
echo "  [1/6] Generating wine data from Excel..."
if [ -f "$EXCEL_FILE" ]; then
    python3 "$PROJECT/scripts/generate_constants.py" "$EXCEL_FILE" "$PROJECT/src/constants.ts"
    echo "        ✓ constants.ts generated"
else
    echo "        ✗ Excel file not found: $EXCEL_FILE"
    echo "        Using bundled constants.ts instead..."
    if [ -f "$SCRIPT_DIR/constants.ts" ]; then
        cp "$SCRIPT_DIR/constants.ts" "$PROJECT/src/constants.ts"
        echo "        ✓ Using fallback constants.ts"
    else
        echo "        ✗ No constants.ts available!"
        exit 1
    fi
fi

# ── Copy logo if available ──
echo "  [2/6] Setting up assets..."
if [ -f "$LOGO" ]; then
    cp "$LOGO" "$PROJECT/assets/sommni-logo.png"
    echo "        ✓ Logo copied"
else
    echo "        - No logo found (optional)"
fi

# ── Copy source files ──
echo "  [3/6] Installing source files..."
cp "$SCRIPT_DIR/package.json"    "$PROJECT/package.json"
cp "$SCRIPT_DIR/tsconfig.json"   "$PROJECT/tsconfig.json"
cp "$SCRIPT_DIR/index.html"      "$PROJECT/index.html"
cp "$SCRIPT_DIR/pages.ts"        "$PROJECT/src/pages.ts"
cp "$SCRIPT_DIR/events.ts"       "$PROJECT/src/events.ts"
cp "$SCRIPT_DIR/Main.ts"         "$PROJECT/src/Main.ts"
cp "$SCRIPT_DIR/ui.ts"           "$PROJECT/src/ui.ts"
cp "$SCRIPT_DIR/image-utils.ts"  "$PROJECT/src/image-utils.ts"
cp "$SCRIPT_DIR/style.css"       "$PROJECT/src/style.css"
echo "        ✓ Source files ready"

# ── Install dependencies ──
echo "  [4/6] Installing dependencies..."
cd "$PROJECT"
npm install --silent 2>&1 | tail -1
echo "        ✓ Dependencies installed"

# ── Count wines ──
WINE_COUNT=$(grep -o '"name":' "$PROJECT/src/constants.ts" 2>/dev/null | wc -l || echo "?")

# ── Summary ──
echo ""
echo "  [5/6] Build Summary"
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║  sommNI v0.1.0                                                 ║"
echo "  ║  $WINE_COUNT wines loaded                                            ║"
echo "  ╠════════════════════════════════════════════════════════════════╣"
echo "  ║  Navigation:                                                   ║"
echo "  ║    Home → Type → Country → Style → Wine → Tasting Notes       ║"
echo "  ║                                                                ║"
echo "  ║  Wine Types (in order):                                        ║"
echo "  ║    Red · White · Sparkling · Rosé · Orange · Dessert          ║"
echo "  ║                                                                ║"
echo "  ║  Controls:                                                     ║"
echo "  ║    Single tap  = navigate forward                             ║"
echo "  ║    Double tap  = go back                                       ║"
echo "  ╠════════════════════════════════════════════════════════════════╣"
echo "  ║  Tasting Notes Layout:                                         ║"
echo "  ║    [bold] Wine Name                                            ║"
echo "  ║    Grape · Region · Style                                      ║"
echo "  ║    Appearance / Nose / Palate / Finish                         ║"
echo "  ║    Anecdote                                                    ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo ""

# ── Launch ──
echo "  [6/6] Starting dev server..."
echo ""
cd "$PROJECT"
npx vite --host
