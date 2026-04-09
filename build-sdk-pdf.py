#!/usr/bin/env python3
"""Build a clean PDF from the Even Hub SDK reference markdown."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Preformatted, HRFlowable,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import re, os

# ── Paths ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(SCRIPT_DIR, "EVENHUB_SDK_REFERENCE.md")
PDF_PATH = os.path.join(SCRIPT_DIR, "EVENHUB_SDK_REFERENCE.pdf")

# ── Styles ──
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    name='DocTitle', parent=styles['Title'],
    fontSize=22, leading=28, textColor=HexColor('#1a1a2e'),
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name='DocSubtitle', parent=styles['Normal'],
    fontSize=10, leading=14, textColor=HexColor('#666666'),
    alignment=TA_CENTER, spaceAfter=20,
))
styles.add(ParagraphStyle(
    name='H2', parent=styles['Heading2'],
    fontSize=16, leading=20, textColor=HexColor('#1a1a2e'),
    spaceBefore=18, spaceAfter=8,
    borderWidth=0, borderColor=HexColor('#d4af37'),
    borderPadding=(0, 0, 4, 0),
))
styles.add(ParagraphStyle(
    name='H3', parent=styles['Heading3'],
    fontSize=13, leading=16, textColor=HexColor('#333355'),
    spaceBefore=12, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name='H4', parent=styles['Heading4'],
    fontSize=11, leading=14, textColor=HexColor('#555577'),
    spaceBefore=8, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name='Body', parent=styles['Normal'],
    fontSize=9.5, leading=13, textColor=HexColor('#222222'),
    spaceAfter=6,
))
styles.add(ParagraphStyle(
    name='CodeBlock', parent=styles['Code'],
    fontSize=8, leading=10, textColor=HexColor('#1a1a2e'),
    backColor=HexColor('#f4f4f8'),
    borderWidth=0.5, borderColor=HexColor('#ccccdd'),
    borderPadding=6, borderRadius=3,
    spaceAfter=8, spaceBefore=4,
    leftIndent=8, rightIndent=8,
))
styles.add(ParagraphStyle(
    name='BulletItem', parent=styles['Normal'],
    fontSize=9.5, leading=13, textColor=HexColor('#222222'),
    leftIndent=20, bulletIndent=8, spaceAfter=3,
    bulletFontSize=9, bulletColor=HexColor('#d4af37'),
))
styles.add(ParagraphStyle(
    name='TableCell', parent=styles['Normal'],
    fontSize=8.5, leading=11, textColor=HexColor('#222222'),
))
styles.add(ParagraphStyle(
    name='TableHeader', parent=styles['Normal'],
    fontSize=8.5, leading=11, textColor=HexColor('#ffffff'),
    fontName='Helvetica-Bold',
))

def escape_xml(text):
    """Escape XML special chars for ReportLab Paragraph."""
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    return text

def inline_format(text):
    """Convert markdown inline formatting to ReportLab XML."""
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Inline code
    text = re.sub(r'`(.+?)`', r'<font face="Courier" size="8.5" color="#8b0000">\1</font>', text)
    return text

def parse_md_to_story(md_text):
    story = []
    lines = md_text.split('\n')
    i = 0
    in_code = False
    code_buf = []

    while i < len(lines):
        line = lines[i]

        # Code blocks
        if line.strip().startswith('```'):
            if in_code:
                code_text = escape_xml('\n'.join(code_buf))
                story.append(Preformatted(code_text, styles['CodeBlock']))
                code_buf = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        stripped = line.strip()

        # Skip horizontal rules and frontmatter markers
        if stripped == '---' or stripped == '':
            i += 1
            continue

        # Title (# )
        if stripped.startswith('# ') and not stripped.startswith('## '):
            title = stripped[2:].strip()
            story.append(Paragraph(escape_xml(title), styles['DocTitle']))
            i += 1
            continue

        # Blockquote (subtitle)
        if stripped.startswith('> '):
            text = stripped[2:].strip()
            text = escape_xml(text)
            story.append(Paragraph(text, styles['DocSubtitle']))
            i += 1
            continue

        # H2
        if stripped.startswith('## '):
            heading = stripped[3:].strip()
            story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor('#d4af37'),
                                     spaceBefore=12, spaceAfter=4))
            story.append(Paragraph(escape_xml(heading), styles['H2']))
            i += 1
            continue

        # H3
        if stripped.startswith('### '):
            heading = stripped[4:].strip()
            story.append(Paragraph(inline_format(escape_xml(heading)), styles['H3']))
            i += 1
            continue

        # H4
        if stripped.startswith('#### '):
            heading = stripped[5:].strip()
            story.append(Paragraph(inline_format(escape_xml(heading)), styles['H4']))
            i += 1
            continue

        # Table
        if '|' in stripped and stripped.startswith('|'):
            table_rows = []
            while i < len(lines) and '|' in lines[i].strip() and lines[i].strip().startswith('|'):
                row_text = lines[i].strip()
                # Skip separator rows
                if re.match(r'^\|[\s\-:|]+\|$', row_text):
                    i += 1
                    continue
                cells = [c.strip() for c in row_text.split('|')[1:-1]]
                table_rows.append(cells)
                i += 1

            if table_rows:
                # Build table
                header = table_rows[0]
                data_rows = table_rows[1:]
                t_data = []
                t_data.append([Paragraph(inline_format(escape_xml(c)), styles['TableHeader']) for c in header])
                for row in data_rows:
                    t_data.append([Paragraph(inline_format(escape_xml(c)), styles['TableCell']) for c in row])

                col_count = len(header)
                available = 6.5 * inch
                col_widths = [available / col_count] * col_count

                t = Table(t_data, colWidths=col_widths)
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a1a2e')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
                    ('FONTSIZE', (0, 0), (-1, -1), 8.5),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#ccccdd')),
                    ('BACKGROUND', (0, 1), (-1, -1), HexColor('#fafafa')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f4f4f8')]),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ]))
                story.append(Spacer(1, 4))
                story.append(t)
                story.append(Spacer(1, 8))
            continue

        # Bullet points
        if stripped.startswith('- '):
            text = stripped[2:].strip()
            text = inline_format(escape_xml(text))
            story.append(Paragraph(text, styles['BulletItem'], bulletText='\u2022'))
            i += 1
            continue

        # Regular paragraph
        text = inline_format(escape_xml(stripped))
        story.append(Paragraph(text, styles['Body']))
        i += 1

    return story

# ── Build ──
with open(MD_PATH, 'r') as f:
    md = f.read()

doc = SimpleDocTemplate(
    PDF_PATH, pagesize=letter,
    leftMargin=0.75*inch, rightMargin=0.75*inch,
    topMargin=0.75*inch, bottomMargin=0.75*inch,
    title="Even Hub SDK Reference",
    author="d3hospitality",
)

story = parse_md_to_story(md)
doc.build(story)
print(f"PDF created: {PDF_PATH}")
