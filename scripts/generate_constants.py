#!/usr/bin/env python3
"""
sommNI — Wine Data Generator
Reads Excel spreadsheet and generates constants.ts for the G2 glasses app.

Usage:
    python generate_constants.py /path/to/wine_data.xlsx /path/to/output/constants.ts
"""

import sys
import json
import pandas as pd
from pathlib import Path
from typing import Dict, List, Any

# Canonical ordering for wine types and styles
TYPE_ORDER = ["Red", "White", "Sparkling", "Rose", "Orange", "Dessert"]

STYLE_ORDER = [
    # Red/White dry styles
    "Dry – Elegant",
    "Dry – Structured",
    "Dry – Full",
    "Dry – Medium",
    "Dry – Fruit-Forward",
    "Dry – Oaked",
    "Dry – Rustic",
    "Dry – Crisp",
    "Dry – Mineral-Driven",
    "Dry – Aromatic",
    "Dry – Textural",
    # Sparkling styles
    "Brut",
    "Brut Rosé",
    "Extra Brut",
    # Dessert/Sweet
    "Sweet",
]

TYPE_DISPLAY = {
    "Red": "Red",
    "White": "White",
    "Sparkling": "Sparkling",
    "Rose": "Rosé",
    "Orange": "Orange",
    "Dessert": "Dessert",
}


def clean_text(text: Any) -> str:
    """Clean and normalize text values."""
    if pd.isna(text):
        return ""
    return str(text).strip()


def style_sort_key(style: str) -> int:
    """Return sort key for styles based on canonical order."""
    try:
        return STYLE_ORDER.index(style)
    except ValueError:
        return len(STYLE_ORDER)  # Unknown styles go last


def load_wine_data(excel_path: str) -> pd.DataFrame:
    """Load wine data from Excel file."""
    df = pd.read_excel(excel_path, sheet_name='Wine Notes')
    
    # Clean column names
    df.columns = df.columns.str.strip()
    
    # Ensure we have all required columns
    required = ['Type', 'Style', 'Country', 'Region, Country', 'Wine Name', 
                'Grape', 'Appearance', 'Nose', 'Palate', 'Finish', 'Anecdote']
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    
    return df


def build_wine_dict(df: pd.DataFrame) -> Dict[str, Dict[str, List[Dict]]]:
    """
    Build the WINES nested dictionary structure.
    Organized as: Type -> Country -> [wines sorted by style]
    """
    wines: Dict[str, Dict[str, List[Dict]]] = {}
    
    for wine_type in TYPE_ORDER:
        type_df = df[df['Type'] == wine_type]
        if type_df.empty:
            continue
            
        wines[wine_type] = {}
        
        # Get countries for this type, sorted alphabetically
        countries = sorted(type_df['Country'].unique())
        
        for country in countries:
            country_df = type_df[type_df['Country'] == country]
            
            # Sort wines by style order, then by name within style
            country_df = country_df.copy()
            country_df['_style_order'] = country_df['Style'].apply(style_sort_key)
            country_df = country_df.sort_values(['_style_order', 'Wine Name'])
            
            wine_list = []
            for _, row in country_df.iterrows():
                wine = {
                    "name": clean_text(row['Wine Name']),
                    "grape": clean_text(row['Grape']),
                    "style": clean_text(row['Style']),
                    "region": clean_text(row['Region, Country']),
                    "appearance": clean_text(row['Appearance']),
                    "nose": clean_text(row['Nose']),
                    "palate": clean_text(row['Palate']),
                    "finish": clean_text(row['Finish']),
                    "anecdote": clean_text(row['Anecdote']),
                }
                wine_list.append(wine)
            
            wines[wine_type][country] = wine_list
    
    return wines


def build_countries_dict(df: pd.DataFrame) -> Dict[str, List[str]]:
    """Build the COUNTRIES dictionary: Type -> sorted list of countries."""
    countries: Dict[str, List[str]] = {}
    
    for wine_type in TYPE_ORDER:
        type_df = df[df['Type'] == wine_type]
        if not type_df.empty:
            countries[wine_type] = sorted(type_df['Country'].unique().tolist())
    
    return countries


def generate_typescript(wines: Dict, countries: Dict) -> str:
    """Generate the complete constants.ts TypeScript file."""
    
    lines = [
        "// ═══════════════════════════════════════════════════════════════════",
        "// sommNI — Wine Tasting Notes Data",
        "// Auto-generated from Excel spreadsheet",
        "// Do not edit manually — regenerate via: python scripts/generate_constants.py",
        "// ═══════════════════════════════════════════════════════════════════",
        "",
        'export const DISPLAY = { WIDTH: 576, HEIGHT: 288 } as const;',
        "",
        f'export const WINE_TYPES = {json.dumps(TYPE_ORDER)} as const;',
        'export type WineType = typeof WINE_TYPES[number];',
        "",
        f'export const TYPE_DISPLAY: Record<WineType, string> = {json.dumps(TYPE_DISPLAY)};',
        "",
        "export interface Wine {",
        "  name: string;",
        "  grape: string;",
        "  style: string;",
        "  region: string;",
        "  appearance: string;",
        "  nose: string;",
        "  palate: string;",
        "  finish: string;",
        "  anecdote: string;",
        "}",
        "",
        f'export const COUNTRIES: Record<WineType, string[]> = {json.dumps(countries, indent=2)};',
        "",
        f'export const STYLE_ORDER: string[] = {json.dumps(STYLE_ORDER)};',
        "",
    ]
    
    # Generate WINES object with proper formatting
    lines.append("export const WINES: Record<string, Record<string, Wine[]>> = {")
    
    for wine_type in TYPE_ORDER:
        if wine_type not in wines:
            continue
            
        lines.append(f'  "{wine_type}": {{')
        
        type_countries = sorted(wines[wine_type].keys())
        for i, country in enumerate(type_countries):
            wine_list = wines[wine_type][country]
            
            # Format wine list as JSON
            wines_json = json.dumps(wine_list, ensure_ascii=False)
            
            comma = "," if i < len(type_countries) - 1 else ""
            lines.append(f'    "{country}": {wines_json}{comma}')
        
        # Check if this is the last type with data
        remaining_types = [t for t in TYPE_ORDER[TYPE_ORDER.index(wine_type)+1:] if t in wines]
        type_comma = "," if remaining_types else ""
        lines.append(f'  }}{type_comma}')
    
    lines.append("};")
    lines.append("")
    
    # Add helper functions
    lines.extend([
        "export function getStylesForCountry(type: WineType, country: string): string[] {",
        "  const wines = WINES[type]?.[country] || [];",
        "  const styleSet = new Set<string>();",
        "  const result: string[] = [];",
        "  ",
        "  // Get styles in order they appear (already sorted by STYLE_ORDER in data)",
        "  for (const w of wines) {",
        "    if (!styleSet.has(w.style)) {",
        "      styleSet.add(w.style);",
        "      result.push(w.style);",
        "    }",
        "  }",
        "  return result;",
        "}",
        "",
        "export function getWinesForStyle(type: WineType, country: string, style: string): Wine[] {",
        "  return (WINES[type]?.[country] || []).filter(w => w.style === style);",
        "}",
        "",
        "export function formatTastingNotes(wine: Wine): string {",
        "  const parts: string[] = [];",
        '  if (wine.appearance) parts.push("Appearance: " + wine.appearance);',
        '  if (wine.nose) parts.push("Nose: " + wine.nose);',
        '  if (wine.palate) parts.push("Palate: " + wine.palate);',
        '  if (wine.finish) parts.push("Finish: " + wine.finish);',
        '  if (wine.anecdote) { parts.push(""); parts.push("Anecdote: " + wine.anecdote); }',
        '  return parts.join("\\n");',
        "}",
        "",
        "// ═══════════════════════════════════════════════════════════════════",
        "// Statistics",
        "// ═══════════════════════════════════════════════════════════════════",
    ])
    
    # Add statistics as comments
    total_wines = sum(len(w) for type_wines in wines.values() for w in type_wines.values())
    lines.append(f"// Total wines: {total_wines}")
    for wine_type in TYPE_ORDER:
        if wine_type in wines:
            type_count = sum(len(w) for w in wines[wine_type].values())
            lines.append(f"// - {wine_type}: {type_count}")
    lines.append("")
    
    return "\n".join(lines)


def main():
    if len(sys.argv) < 3:
        print("Usage: python generate_constants.py <excel_path> <output_path>")
        print("Example: python generate_constants.py ./wine_data.xlsx ./src/constants.ts")
        sys.exit(1)
    
    excel_path = sys.argv[1]
    output_path = sys.argv[2]
    
    print(f"📖 Reading: {excel_path}")
    df = load_wine_data(excel_path)
    print(f"   Found {len(df)} wines")
    
    print("🔧 Building data structures...")
    wines = build_wine_dict(df)
    countries = build_countries_dict(df)
    
    print("📝 Generating TypeScript...")
    typescript = generate_typescript(wines, countries)
    
    print(f"💾 Writing: {output_path}")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(typescript)
    
    # Summary
    total = sum(len(w) for type_wines in wines.values() for w in type_wines.values())
    print()
    print("═" * 50)
    print(f"✅ Generated constants.ts with {total} wines")
    print()
    for wine_type in TYPE_ORDER:
        if wine_type in wines:
            count = sum(len(w) for w in wines[wine_type].values())
            country_count = len(wines[wine_type])
            print(f"   {TYPE_DISPLAY[wine_type]:12} {count:3} wines across {country_count} countries")
    print("═" * 50)


if __name__ == "__main__":
    main()
