#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# sommNI — Quick Data Update
# Regenerates constants.ts from the Excel file without full rebuild
# ════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$HOME/sommni"
EXCEL_FILE="$HOME/Desktop/sommNI 2/02_17_26_-_Wine_Tasting_Notes_-_ソムニ_sommNI_Final.xlsx"

echo ""
echo "  sommNI — Quick Data Update"
echo "  ════════════════════════════════════════"
echo ""

if [ ! -f "$EXCEL_FILE" ]; then
    echo "  ✗ Excel file not found:"
    echo "    $EXCEL_FILE"
    exit 1
fi

echo "  📖 Reading Excel file..."
python3 "$SCRIPT_DIR/scripts/generate_constants.py" "$EXCEL_FILE" "$PROJECT/src/constants.ts"

echo ""
echo "  ✅ Data updated! Vite will hot-reload automatically."
echo ""
