# -*- coding: utf-8 -*-
"""
COA Menu Planner - Test Environment Setup
==========================================
Run once before executing any test files.

What this does:
  1. Verifies all four test accounts are reachable (ADMIN, NM, RD, KITCHEN)
  2. Creates any missing accounts via POST /api/users as ADMIN
  3. Finds or creates baseline test recipes for use across test modules:
       - one HOT_ENTREE (chicken, protein_group=CHICKEN)
       - one COLD_ENTREE (protein_group=CHICKEN) — for protein conflict tests
       - a second distinct CHICKEN HOT_ENTREE — for protein conflict tests
       - one HOT_ENTREE (protein_group=FISH) — for fish-frequency conflict tests
  4. Cleans any existing menu for TEST_MONTH to ensure a blank slate
  5. Writes test_state.json with all IDs needed by subsequent test files

Usage:
  cd coa-tests/
  python setup.py
"""
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from helpers import (
    API_URL, CREDS, TEST_MONTH, TEST_YEAR, TEST_MONTH_N,
    get_session, load_state, save_state,
)

SEP = '-' * 60

def check_server():
    print(f'\n{SEP}')
    print(f'  Checking API at {API_URL} …')
    try:
        r = httpx.get(f'{API_URL.replace("/api","").rstrip("/")}/health', timeout=5)
        print(f'  Server responded: {r.status_code} {r.text[:80]}')
    except Exception as e:
        print(f'  !! Cannot reach server: {e}')
        print(f'  Make sure the API is running: cd apps/api && npm run dev')
        sys.exit(1)
    print(SEP)

def verify_accounts():
    print('\n[1] Verifying test accounts …')
    sessions = {}
    for role, (email, password) in CREDS.items():
        r = httpx.post(f'{API_URL}/api/auth/login',
                       json={'email': email, 'password': password})
        if r.status_code == 200:
            print(f'  ✓ {role:<8} {email}')
            sessions[role] = r.cookies
        elif r.status_code == 401:
            print(f'  ✗ {role:<8} {email} — login failed (wrong password or account missing)')
            # Try to create via admin if admin session exists
            if role != 'admin' and 'admin' in sessions:
                _create_account(sessions['admin'], role, email, password)
                # Re-login
                r2 = httpx.post(f'{API_URL}/api/auth/login',
                                 json={'email': email, 'password': password})
                if r2.status_code == 200:
                    print(f'    ✓ Created and verified {role}')
                    sessions[role] = r2.cookies
                else:
                    print(f'    !! Still cannot log in as {role}; aborting')
                    sys.exit(1)
            else:
                print(f'  !! Cannot verify admin — run apps/api seed first:')
                print(f'       cd apps/api && node db/seeds/002_users.js')
                sys.exit(1)
        else:
            print(f'  ✗ {role:<8} {email} — unexpected {r.status_code}: {r.text}')
            sys.exit(1)
    return sessions

def _create_account(admin_cookies, role, email, password):
    role_map = {
        'nm':      'NUTRITION_MANAGER',
        'rd':      'DIETITIAN',
        'kitchen': 'KITCHEN_STAFF',
    }
    r = httpx.post(f'{API_URL}/api/users',
                   json={
                       'name':     role.upper(),
                       'email':    email,
                       'password': password,
                       'role':     role_map[role],
                   },
                   cookies=admin_cookies)
    if r.status_code not in (200, 201):
        print(f'    !! Failed to create {role}: {r.status_code} {r.text}')
        sys.exit(1)

def get_or_create_recipe(nm_cookies, name, category, protein_group):
    """Find existing recipe by name or create a new one. Returns recipe dict."""
    # Search active recipes
    r = httpx.get(f'{API_URL}/api/recipes', cookies=nm_cookies)
    if r.status_code == 200:
        for recipe in r.json():
            if recipe['name'] == name:
                print(f'  ✓ Found existing recipe: {name} ({recipe["id"][:8]}…)')
                return recipe

    # Also check pending-review (inactive)
    r2 = httpx.get(f'{API_URL}/api/recipes/pending-review', cookies=nm_cookies)
    if r2.status_code == 200:
        for recipe in r2.json():
            if recipe['name'] == name:
                print(f'  ✓ Found pending recipe: {name} ({recipe["id"][:8]}…)')
                return recipe

    # Create it
    payload = {
        'name':          name,
        'category':      category,
        'base_servings': 100,
        'is_active':     True,
    }
    if protein_group:
        payload['protein_group'] = protein_group
    r3 = httpx.post(f'{API_URL}/api/recipes', json=payload, cookies=nm_cookies)
    if r3.status_code == 201:
        recipe = r3.json()
        print(f'  ✓ Created recipe: {name} ({recipe["id"][:8]}…)')
        return recipe
    else:
        print(f'  !! Failed to create recipe "{name}": {r3.status_code} {r3.text}')
        sys.exit(1)

def setup_recipes(sessions):
    print('\n[2] Setting up test recipes …')
    nm = sessions['nm']
    recipes = {}

    recipes['hot_chicken']  = get_or_create_recipe(nm, '[TEST] Hot Chicken Entree',  'HOT_ENTREE',  'CHICKEN')
    recipes['hot_chicken2'] = get_or_create_recipe(nm, '[TEST] Hot Chicken Entree 2','HOT_ENTREE',  'CHICKEN')
    recipes['cold_chicken'] = get_or_create_recipe(nm, '[TEST] Cold Chicken',         'COLD_ENTREE', 'CHICKEN')
    recipes['fish']         = get_or_create_recipe(nm, '[TEST] Baked Fish',           'HOT_ENTREE',  'FISH')
    recipes['side']         = get_or_create_recipe(nm, '[TEST] Green Beans',          'SIDE',        None)

    return {k: v['id'] for k, v in recipes.items()}

def clean_test_menu(sessions):
    print(f'\n[3] Cleaning up any existing menu for {TEST_MONTH} …')
    nm = sessions['nm']
    r = httpx.get(f'{API_URL}/api/menus',
                  params={'year': TEST_YEAR, 'month': TEST_MONTH_N},
                  cookies=nm)
    if r.status_code != 200:
        print(f'  Could not list menus: {r.status_code}')
        return None

    menus = r.json()
    if isinstance(menus, list):
        for m in menus:
            if m.get('year') == TEST_YEAR and m.get('month') == TEST_MONTH_N:
                print(f'  Found existing menu {m["id"][:8]}… (status={m["status"]})')
                # We cannot delete via API; note it for manual cleanup
                print(f'  ⚠  Menu exists — tests may get 409 on create. To reset:')
                print(f'     DELETE FROM menus WHERE id = \'{m["id"]}\';')
                return m['id']
    print(f'  ✓ No existing menu for {TEST_MONTH}')
    return None

def write_state(recipe_ids, existing_menu_id, sessions):
    print('\n[4] Writing test_state.json …')
    state = load_state()
    state.update({
        'recipe_ids':        recipe_ids,
        'existing_menu_id':  existing_menu_id,
        'test_month':        TEST_MONTH,
        'test_year':         TEST_YEAR,
        'test_month_n':      TEST_MONTH_N,
        # Store user emails for role-checking in tests
        'admin_email':  CREDS['admin'][0],
        'nm_email':     CREDS['nm'][0],
        'rd_email':     CREDS['rd'][0],
        'kitchen_email': CREDS['kitchen'][0],
    })
    save_state(state)
    print(f'  ✓ test_state.json written')
    print(f'  Recipe IDs:')
    for k, v in recipe_ids.items():
        print(f'    {k:<15} {v}')

def main():
    print('\n' + '='*60)
    print('  COA Menu Planner — Test Setup')
    print('='*60)

    check_server()
    sessions    = verify_accounts()
    recipe_ids  = setup_recipes(sessions)
    menu_id     = clean_test_menu(sessions)
    write_state(recipe_ids, menu_id, sessions)

    print('\n' + '='*60)
    print('  Setup complete. Run tests with:')
    print('    python test_01_auth.py')
    print('    python test_02_recipes.py')
    print('    python test_03_menu_planning.py')
    print('    python test_04_approval.py')
    print('  Or all at once:')
    print('    python run_all.py')
    print('='*60 + '\n')

if __name__ == '__main__':
    main()
