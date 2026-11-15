"""
CBORD NetMenu Production Recipe PDF importer.

Pipeline:
  1. OCR a PDF via pdf2image + pytesseract.
  2. Stitch multi-page recipes by detecting "Page X of N" footers (N > 1).
  3. Parse one recipe per logical group: name, category, yield, serving
     utensil, ingredients, instructions, modified-diet notes.
  4. Split each ingredient string into (name, qty, unit) using rules tuned
     for the CBORD format.

Two layouts are supported:
  * single-column ingredient lines  ("- Celery 4 Pound 8 Ounce")
  * two-column ingredient tables    ("- Ground Beef 80/20" + later block of
    bare quantity lines, zipped by position)

CLI:
  python cbord_importer.py path/to/file.pdf            → JSON to stdout
  python cbord_importer.py --ocr-text path/to/file.txt → JSON, skip OCR
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

# --- OCR setup ---------------------------------------------------------------
# Honor environment overrides so the same code runs on dev (Windows) and in
# the Cloud Run container (Linux paths via apt-get).
TESSERACT_CMD = os.environ.get(
    'TESSERACT_CMD',
    r'C:\Program Files\Tesseract-OCR\tesseract.exe' if os.name == 'nt' else 'tesseract',
)
POPPLER_PATH = os.environ.get(
    'POPPLER_PATH',
    r'C:\poppler\Library\bin' if os.name == 'nt' else None,
)


# --- Category heuristics -----------------------------------------------------
HOT_ENTREE_KEYWORDS = re.compile(
    r'\b(chicken|turkey|beef|pork|ham|fish|salmon|tilapia|sausage|hamburger|'
    r'stroganoff|thigh|breast|meatball|meatloaf|stew|chili|lasagna|spaghetti|'
    r'enchilada|burrito|taco|cutlet|loaf|patty|pot[ -]?pie|shepherd|brat|'
    r'burger|cheeseburger|sloppy|steak|veal|lamb|goulash|casserole|marsala|'
    r'mushroom\s+swiss|tropical)\b',
    re.IGNORECASE,
)
DESSERT_KEYWORDS = re.compile(
    r'\b(cake|shortcake|brownie|cookie|pudding|fruit\s+cup|jello|crisp|'
    r'cobbler|tart|cheesecake|ice\s+cream|dessert)\b',
    re.IGNORECASE,
)
BREAD_KEYWORDS = re.compile(
    r'\b(bread|roll|biscuit|muffin|bun|cornbread|toast|tortilla)\b',
    re.IGNORECASE,
)
FRUIT_KEYWORDS = re.compile(
    r'\b(applesauce|peaches|pears|pineapple|mandarin|fruit\s+cocktail|grapes|'
    r'berries|melon|cantaloupe|watermelon|banana|apple\s+slices|orange\s+wedges|'
    r'fruit\s+salad)\b',
    re.IGNORECASE,
)


# --- Ingredient splitter -----------------------------------------------------
# CBORD ingredient quantity formats:
#   "4 Pound 8 Ounce"     - mixed primary + secondary unit
#   "1 1/2 Quart 1/4 Cup" - mixed numeral + secondary
#   "5.66 1 Cup, diced"   - decimal weight + count + unit + prep modifier
#   "24 1 Each"           - count + each
#   "1 Tablespoon"        - simple
UNIT_RE = (
    r'(?:Pound|Pounds|Lb|Lbs|Ounce|Ounces|Oz|Cup|Cups|Tablespoon|Tablespoons|'
    r'Tbsp|Teaspoon|Teaspoons|Tsp|Quart|Quarts|Qt|Gallon|Gallons|Gal|Each|'
    r'Spray|Pint|Pints|Slice|Slices|Liter|Liters|ml|mL|gram|grams|g|kg)'
)
# A numeric "token" can be: integer, decimal, simple fraction, or mixed numeral
# (e.g. "1 1/2"). We allow optional trailing space + fraction to capture mixed.
NUMERIC_TOKEN_RE = r'(?:\d+\s+\d+/\d+|\d+(?:[/.]\d+)?)'


def _parse_qty_to_float(qty_str):
    """Best-effort numeric parse of '4', '1/2', '1 1/2', '5.66'. None on fail."""
    if qty_str is None:
        return None
    s = qty_str.strip()
    # Mixed numeral
    m = re.fullmatch(r'(\d+)\s+(\d+)/(\d+)', s)
    if m:
        whole, num, den = map(int, m.groups())
        return whole + num / den
    # Simple fraction
    m = re.fullmatch(r'(\d+)/(\d+)', s)
    if m:
        num, den = map(int, m.groups())
        return num / den
    # Decimal or integer
    try:
        return float(s)
    except ValueError:
        return None


def split_ingredient(text):
    """Split a raw CBORD ingredient string into structured fields.

    Returns dict with name, qty, unit, qty_value (float), raw_qty, and
    `needs_review` flag if confidence is low.
    """
    text = text.strip()

    # Find the first occurrence of "NUMBER UNIT" where UNIT is in our list.
    # Walk backwards to include any preceding numeric tokens (so "5.66 1 Cup"
    # all becomes the quantity, not just "1 Cup").
    m = re.search(rf'\b({NUMERIC_TOKEN_RE})\s+{UNIT_RE}\b', text)
    if not m:
        return {
            'name': text,
            'qty': None,
            'unit': None,
            'qty_value': None,
            'raw_qty': None,
            'needs_review': True,
        }

    qty_start = m.start(1)
    # Walk backwards through preceding numeric tokens to absorb things like
    # "5.66" in "Onion Dcd 1/4" 5.66 1 Cup" — but ONLY through integers and
    # decimals. Fractions like "80/20" (Ground Beef fat ratio) and "1/4\"" (a
    # size descriptor) are part of the name, not the quantity.
    while qty_start > 0:
        prev_space = text.rfind(' ', 0, qty_start - 1)
        if prev_space < 0:
            break
        prev_token = text[prev_space + 1:qty_start].strip()
        if not prev_token:
            break
        if prev_token.endswith('"') or prev_token.endswith("''"):
            break
        if re.fullmatch(r'\d+(?:\.\d+)?', prev_token):
            qty_start = prev_space + 1
        else:
            break

    name = text[:qty_start].strip().rstrip(',').rstrip()
    raw_qty = text[qty_start:].strip()

    # Parse primary qty + unit out of raw_qty
    pm = re.match(rf'^({NUMERIC_TOKEN_RE})\s+({UNIT_RE})\b(.*)$', raw_qty)
    if pm:
        qty = pm.group(1).strip()
        unit = pm.group(2).strip()
        extra = pm.group(3).strip(' ,')
        # Normalize common unit spellings
        unit_norm = unit.lower()
        unit_canon = {
            'pound': 'lb', 'pounds': 'lb', 'lb': 'lb', 'lbs': 'lb',
            'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
            'cup': 'cup', 'cups': 'cup',
            'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbsp': 'tbsp',
            'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tsp': 'tsp',
            'quart': 'qt', 'quarts': 'qt', 'qt': 'qt',
            'gallon': 'gal', 'gallons': 'gal', 'gal': 'gal',
            'each': 'each',
            'pint': 'pt', 'pints': 'pt',
            'slice': 'slice', 'slices': 'slice',
            'liter': 'l', 'liters': 'l',
            'ml': 'ml', 'gram': 'g', 'grams': 'g', 'g': 'g', 'kg': 'kg',
            'spray': 'spray',
        }.get(unit_norm, unit_norm)
        return {
            'name': name,
            'qty': qty,
            'unit': unit_canon,
            'qty_value': _parse_qty_to_float(qty),
            'raw_qty': raw_qty,
            'extra': extra if extra else None,
            'needs_review': False,
        }

    return {
        'name': name,
        'qty': None,
        'unit': None,
        'qty_value': None,
        'raw_qty': raw_qty,
        'needs_review': True,
    }


# --- Ingredient block parser -------------------------------------------------
def parse_ingredients_block(block):
    """Parse a CBORD ingredient block into a list of raw ingredient strings.

    Handles single-column ("- name qty unit") and two-column (bullets list of
    names followed by a separate block of quantities to be zipped).
    """
    raw_lines = [l.rstrip() for l in block.splitlines()]
    items = []           # list of {'name': str, 'qty_text': str | None}
    current_name = None  # name being assembled across continuation lines

    def flush_current():
        nonlocal current_name
        if current_name is not None:
            items.append({'name': current_name.strip(), 'qty_text': None})
            current_name = None

    for line in raw_lines:
        s = line.strip()
        if not s:
            flush_current()
            continue
        if s.startswith('-'):
            flush_current()
            name_part = s.lstrip('- ').strip()
            # Inline quantity present if "NUM UNIT" appears anywhere in the rest
            inline_m = re.search(rf'\b({NUMERIC_TOKEN_RE})\s+{UNIT_RE}\b', name_part)
            if inline_m:
                # Whole bullet line is a complete ingredient — record as-is.
                items.append({'name': name_part, 'qty_text': '__inline__'})
                current_name = None
            else:
                current_name = name_part
        else:
            # Non-bullet, non-blank line.
            if current_name is not None:
                # Continuation of the current bullet's name (e.g. "Finely Chopped")
                current_name += ' ' + s
            else:
                # Standalone line during/after the bullet block. If it looks
                # like a quantity (has digits + unit), zip it onto the first
                # item that's still missing a qty.
                if re.search(rf'\b({NUMERIC_TOKEN_RE})\s+{UNIT_RE}\b', s):
                    for it in items:
                        if it['qty_text'] is None:
                            it['qty_text'] = s
                            break

    flush_current()

    # Build the raw ingredient strings: either the bullet line is already
    # complete (inline qty), or join name + zipped qty.
    out = []
    for it in items:
        if it['qty_text'] == '__inline__':
            out.append(it['name'])
        elif it['qty_text']:
            out.append(f"{it['name']} {it['qty_text']}".strip())
        else:
            out.append(it['name'])
    return out


# --- Recipe parser -----------------------------------------------------------
def parse_recipe(text):
    """Parse a single recipe's combined text into a structured record."""
    lines = text.splitlines()
    name = None
    cat_line = None
    for i, l in enumerate(lines):
        if 'Production Recipe' in l:
            for j in range(i + 1, min(i + 8, len(lines))):
                if lines[j].strip():
                    name = lines[j].strip()
                    for k in range(j + 1, min(j + 5, len(lines))):
                        s = lines[k].strip()
                        if s and 'Cooking' not in s and 'Serving' not in s:
                            cat_line = s
                            break
                    break
            break

    if not name:
        return None

    yield_match = re.search(r'Yield:\s*(\d+)\s+([^\n]+?)(?:\s+Cooking|\s*$)', text)
    serving_utensil_match = re.search(
        r'Serving Utensil:\s*([^\n]+?)(?:\s+Portions:|\s*$)', text,
    )
    cal_match = re.search(r'Total Calories:\s*(\d+)', text)

    # Ingredient block: case-insensitive header, ends at WASH HANDS or end.
    ing_section = re.search(
        r'[Ii]ngredients\s*&\s*[Ii]nstructions\.\.\.\s*\n+(.*?)(?:WASH\s+HANDS|\Z)',
        text, re.DOTALL,
    )
    raw_ingredients = (
        parse_ingredients_block(ing_section.group(1)) if ing_section else []
    )
    ingredients = [split_ingredient(raw) for raw in raw_ingredients]

    # Instructions: from WASH HANDS to **Modified or Report Date.
    instructions = []
    instr_section = re.search(
        r'WASH\s+HANDS\.?(.*?)(?:\*\*Modified|Report Date:|\Z)', text, re.DOTALL,
    )
    if instr_section:
        instructions = [l.strip() for l in instr_section.group(1).splitlines() if l.strip()]

    diet = re.search(r'\*\*Modified Diet Notes?:?(.*?)(?:Report Date:|\Z)', text, re.DOTALL)
    diet_notes = diet.group(1).strip() if diet else None

    # Categorize. Order matters: protein keyword in NAME wins over
    # dessert/bread keyword (Turkey Shepherd's Pie is HOT_ENTREE, not DESSERT).
    raw = (cat_line or '').lower()
    if HOT_ENTREE_KEYWORDS.search(name):
        category = 'HOT_ENTREE'
    elif FRUIT_KEYWORDS.search(name):
        category = 'FRUIT'
    elif DESSERT_KEYWORDS.search(name):
        category = 'DESSERT'
    elif BREAD_KEYWORDS.search(name) and not re.search(
        r'\bon\s+(bun|bread)\b', name, re.IGNORECASE,
    ):
        category = 'BREAD'
    elif 'cold' in raw:
        category = 'COLD_ENTREE'
    elif 'hot' in raw:
        category = 'SIDE'
    else:
        category = 'SIDE'

    return {
        'name': name,
        'raw_category_label': cat_line,
        'category': category,
        'yield_qty':  int(yield_match.group(1)) if yield_match else None,
        'yield_unit': yield_match.group(2).strip() if yield_match else None,
        'serving_utensil': serving_utensil_match.group(1).strip() if serving_utensil_match else None,
        'calories_per_serving': int(cal_match.group(1)) if cal_match else None,
        'ingredients': ingredients,
        'ingredients_count': len(ingredients),
        'ingredients_needing_review': sum(1 for i in ingredients if i.get('needs_review')),
        'instructions': instructions,
        'instructions_count': len(instructions),
        'has_ccp_notes': any('CCP' in l for l in instructions),
        'diet_notes': diet_notes,
    }


# --- Multi-page handling -----------------------------------------------------
# CBORD prints "Production Recipe" + the recipe name on EVERY page, including
# continuations. A 2-page recipe yields two parseable records — one with the
# ingredients, one with the instructions — both with the same name. We handle
# this at the dedupe layer (merge_record) rather than trying to stitch at the
# text level, because the page footers ("Page X of N") are OCR-unreliable.
def merge_record(into, src):
    """Merge fields of `src` into `into` for a same-name duplicate. Prefers
    non-empty lists; unions diet notes. Mutates `into`."""
    if not into['ingredients'] and src['ingredients']:
        into['ingredients'] = src['ingredients']
        into['ingredients_count'] = src['ingredients_count']
        into['ingredients_needing_review'] = src['ingredients_needing_review']
    if not into['instructions'] and src['instructions']:
        into['instructions'] = src['instructions']
        into['instructions_count'] = src['instructions_count']
        into['has_ccp_notes'] = src['has_ccp_notes']
    if not into.get('diet_notes') and src.get('diet_notes'):
        into['diet_notes'] = src['diet_notes']
    if not into.get('calories_per_serving') and src.get('calories_per_serving'):
        into['calories_per_serving'] = src['calories_per_serving']
    if not into.get('yield_qty') and src.get('yield_qty'):
        into['yield_qty'] = src['yield_qty']
        into['yield_unit'] = src['yield_unit']
    if not into.get('serving_utensil') and src.get('serving_utensil'):
        into['serving_utensil'] = src['serving_utensil']
    # Track all source pages this recipe was assembled from
    if 'source_pages' not in into:
        into['source_pages'] = [into.get('source_page')]
    into['source_pages'].append(src.get('source_page'))
    return into


# --- OCR ---------------------------------------------------------------------
def ocr_pdf(pdf_path, dpi=250):
    """OCR a PDF file. Returns a list of page texts."""
    import pytesseract
    from pdf2image import convert_from_path

    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
    kwargs = {'dpi': dpi}
    if POPPLER_PATH:
        kwargs['poppler_path'] = POPPLER_PATH
    images = convert_from_path(pdf_path, **kwargs)
    return [pytesseract.image_to_string(img) for img in images]


def parse_pre_ocr_text_file(text_path):
    """Parse a file produced by the ad-hoc OCR pipeline (lines like
    `==== PAGE N ====` separating pages). Returns list of page texts in order."""
    with open(text_path, encoding='utf-8') as f:
        text = f.read()
    pages = re.split(r'==== PAGE \d+ ====\n', text)[1:]
    return pages


# --- Top-level orchestration -------------------------------------------------
def looks_like_real_recipe(r):
    """Filter out OCR garbage pages but accept either ingredients OR
    instructions — multi-page recipes split these across two pages."""
    name = (r.get('name') or '').strip()
    if len(name) < 5:
        return False
    letters = sum(c.isalpha() or c.isspace() for c in name)
    if letters / max(len(name), 1) < 0.6:
        return False
    if not name[0].isalpha() or not name[0].isupper():
        return False
    # Need SOMETHING parseable — either ingredients or a meaningful
    # instruction block (>= 3 steps).
    if r['ingredients_count'] == 0 and r['instructions_count'] < 3:
        return False
    return True


def canonical_name(name):
    """OCR-tolerant dedupe key (i/l, 0/o, punctuation, whitespace)."""
    s = name.lower()
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    s = re.sub(r'[il]', 'i', s)
    s = re.sub(r'[o0]', 'o', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def import_from_pages(page_texts, source_label=None):
    """Given OCR'd pages, return a list of unique parsed recipe records.

    Each PDF page parses as one record; multi-page recipes are reassembled
    at dedupe time by merging same-name records' fields.
    """
    raw_records = []
    for i, text in enumerate(page_texts, 1):
        r = parse_recipe(text)
        if not r:
            continue
        r['source_page'] = i
        if source_label:
            r['source'] = source_label
        if looks_like_real_recipe(r):
            raw_records.append(r)

    # Dedupe by canonical name, MERGING multi-page recipes.
    seen = {}
    duplicates_merged = 0
    for r in raw_records:
        key = canonical_name(r['name'])
        if key in seen:
            merge_record(seen[key], r)
            duplicates_merged += 1
        else:
            seen[key] = r

    records = list(seen.values())
    return {
        'records': records,
        'stats': {
            'pdf_pages':            len(page_texts),
            'parsed_pages':         len(raw_records),
            'unique_recipes':       len(records),
            'duplicates_merged':    duplicates_merged,
            'by_category':          dict(Counter(r['category'] for r in records)),
        },
    }


def main():
    ap = argparse.ArgumentParser(description='CBORD NetMenu PDF recipe importer.')
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('pdf', nargs='?', help='Path to a CBORD PDF.')
    src.add_argument('--ocr-text', help='Skip OCR and read pre-OCR\'d text file.')
    ap.add_argument('--dpi', type=int, default=250, help='OCR DPI (default 250).')
    ap.add_argument('--source-label', default=None, help='Optional source label.')
    ap.add_argument('--summary', action='store_true', help='Print summary to stderr.')
    args = ap.parse_args()

    if args.ocr_text:
        pages = parse_pre_ocr_text_file(args.ocr_text)
        label = args.source_label or os.path.basename(args.ocr_text)
    else:
        pages = ocr_pdf(args.pdf, dpi=args.dpi)
        label = args.source_label or os.path.basename(args.pdf)

    result = import_from_pages(pages, source_label=label)

    if args.summary:
        print(json.dumps(result['stats'], indent=2), file=sys.stderr)

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
