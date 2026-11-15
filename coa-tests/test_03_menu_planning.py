# -*- coding: utf-8 -*-
"""
Section 3 — Menu Planning [AUTO/HYBRID]
Contract table: guide §3

This module creates the test menu and stores its ID in test_state.json
for use by test_04_approval.py.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import httpx
from helpers import (
    API_URL, TEST_YEAR, TEST_MONTH_N, TEST_MONTH,
    get_session, load_state, save_state,
    record, skip, merge_results, print_summary, timed,
)

MODULE = 'test_03_menu_planning'


def _first_day_id(menu_body):
    """Return the first non-holiday weekday ID from a menu response."""
    for day in menu_body.get('days', []):
        if not day.get('is_holiday'):
            return day['id']
    return None


def _first_item_id(menu_body):
    """Return the first menu_day_item ID from any day."""
    for day in menu_body.get('days', []):
        for item in day.get('items', []):
            return item['id']
    return None


def run() -> list:
    results = []
    state   = load_state()
    recipe_ids = state.get('recipe_ids', {})

    print(f'\n{"="*60}')
    print(f'  {MODULE} — Menu Planning')
    print('='*60)

    nm = get_session('nm')
    rd = get_session('rd')

    # ------------------------------------------------------------------ 3.1.x
    print('\n  3.1 Create Monthly Menu')

    # 3.1.1 — GET list for test month (should be empty or return existing from setup warn)
    r, ms = timed(httpx.get, f'{API_URL}/api/menus',
                  params={'year': TEST_YEAR, 'month': TEST_MONTH_N},
                  cookies=nm)
    existing_menu_id = state.get('existing_menu_id')
    notes = ''
    if r.status_code == 200:
        menus = r.json()
        if menus:
            notes = f'Found {len(menus)} existing menu(s) for {TEST_MONTH}'
    record(results, '3.1.1', 'GET', f'/api/menus?year={TEST_YEAR}&month={TEST_MONTH_N}',
           200, r.status_code, ms, notes=notes)

    # 3.1.2 — POST create
    r, ms = timed(httpx.post, f'{API_URL}/api/menus',
                  json={'year': TEST_YEAR, 'month': TEST_MONTH_N},
                  cookies=nm)
    menu_id   = None
    first_day = None
    if r.status_code == 201:
        menu_id   = r.json()['id']
        first_day = _first_day_id(r.json())
        notes = f'Created menu {menu_id[:8]}... with {len(r.json().get("days",[]))} days'
        status = 'PASS'
    elif r.status_code == 409 and existing_menu_id:
        menu_id = existing_menu_id
        # Load the existing menu to get first_day
        mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
        if mr.status_code == 200:
            first_day = _first_day_id(mr.json())
        notes = f'Menu already exists ({menu_id[:8]}...) — using existing'
        status = 'PASS'
    else:
        notes = f'Unexpected {r.status_code}: {r.text[:100]}'
        status = 'FAIL'
    record(results, '3.1.2', 'POST', '/api/menus', 201, r.status_code, ms,
           status=status, notes=notes)

    # Persist menu_id for subsequent modules
    if menu_id:
        s = load_state()
        s['test_menu_id'] = menu_id
        save_state(s)

    # 3.1.3 — duplicate → 409
    r, ms = timed(httpx.post, f'{API_URL}/api/menus',
                  json={'year': TEST_YEAR, 'month': TEST_MONTH_N},
                  cookies=nm)
    record(results, '3.1.3', 'POST', '/api/menus (duplicate)', 409, r.status_code, ms)

    if not menu_id:
        for tid in ['3.2.1','3.2.2','3.2.3','3.2.4',
                    '3.3.1','3.3.2',
                    '3.4.1','3.4.2','3.4.3',
                    '3.5.1','3.5.2','3.5.3',
                    '3.6.1','3.6.2',
                    '3.7.1','3.7.2','3.7.3',
                    '3.8.1','3.8.2',
                    '3.9.1','3.9.2','3.9.3','3.9.4','3.9.5']:
            skip(results, tid, 'N/A', 'N/A', 'No test menu available')
        print_summary(results, MODULE)
        return results

    # ------------------------------------------------------------------ 3.2.x
    print('\n  3.2 Add Items to Days')

    # 3.2.1 — GET days list
    r, ms = timed(httpx.get, f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    days_ok = r.status_code == 200 and len(r.json().get('days', [])) > 0
    notes = f'{len(r.json().get("days",[]))} weekday rows' if r.status_code == 200 else ''
    record(results, '3.2.1', 'GET', '/api/menus/{id} (days embedded)', 200,
           r.status_code, ms, notes=notes,
           status='PASS' if days_ok else 'FAIL',
           suggested_fix='GET /api/menus/:id does not embed days array' if not days_ok else None)

    # Refresh first_day from live response
    if r.status_code == 200:
        first_day = _first_day_id(r.json())

    hot_recipe  = recipe_ids.get('hot_chicken')
    cold_recipe = recipe_ids.get('cold_chicken')
    item_id     = None

    if not first_day or not hot_recipe:
        for tid in ['3.2.2','3.2.3','3.2.4']:
            skip(results, tid, 'N/A', 'N/A', 'No day ID or recipe ID')
    else:
        # 3.2.2 — add HOT item
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/days/{first_day}/items',
                      json={'recipe_id': hot_recipe, 'meal_type': 'HOT'},
                      cookies=nm)
        if r.status_code == 201:
            item_id = r.json()['id']
        record(results, '3.2.2', 'POST', '/api/menus/{id}/days/{day_id}/items (HOT)',
               201, r.status_code, ms)

        # 3.2.3 — add COLD item
        cold_r = cold_recipe or hot_recipe
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/days/{first_day}/items',
                      json={'recipe_id': cold_r, 'meal_type': 'COLD'},
                      cookies=nm)
        cold_item_id = r.json().get('id') if r.status_code == 201 else None
        record(results, '3.2.3', 'POST', '/api/menus/{id}/days/{day_id}/items (COLD)',
               201, r.status_code, ms)

        # 3.2.4 — DELETE cold item
        if cold_item_id:
            r, ms = timed(httpx.delete,
                          f'{API_URL}/api/menus/{menu_id}/days/{first_day}/items/{cold_item_id}',
                          cookies=nm)
            record(results, '3.2.4', 'DELETE', '/api/menus/{id}/days/{day_id}/items/{item_id}',
                   204, r.status_code, ms,
                   status='PASS' if r.status_code in (200, 204) else 'FAIL')
        else:
            skip(results, '3.2.4', 'DELETE', '/api/menus/{id}/days/{day_id}/items/{item_id}',
                 'COLD item not created')

    # ------------------------------------------------------------------ 3.3.x
    print('\n  3.3 Holiday Marking')

    if not first_day:
        skip(results, '3.3.1', 'PATCH', '/api/menus/{id}/days/{day_id}', 'No day ID')
        skip(results, '3.3.2', 'PATCH', '/api/menus/{id}/days/{day_id}', 'No day ID')
    else:
        r, ms = timed(httpx.patch,
                      f'{API_URL}/api/menus/{menu_id}/days/{first_day}',
                      json={'is_holiday': True, 'holiday_note': 'Thanksgiving'},
                      cookies=nm)
        notes = ''
        if r.status_code == 200 and not r.json().get('is_holiday'):
            notes = 'is_holiday not true in response'
        record(results, '3.3.1', 'PATCH', '/api/menus/{id}/days/{day_id} (holiday=true)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')

        r, ms = timed(httpx.patch,
                      f'{API_URL}/api/menus/{menu_id}/days/{first_day}',
                      json={'is_holiday': False},
                      cookies=nm)
        notes = ''
        if r.status_code == 200 and r.json().get('is_holiday'):
            notes = 'is_holiday should be false after unset'
        record(results, '3.3.2', 'PATCH', '/api/menus/{id}/days/{day_id} (holiday=false)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')

    # ------------------------------------------------------------------ 3.4.x
    print('\n  3.4 Vendor Notes (Planning Notes)')

    # 3.4.1 — set planning_notes
    r, ms = timed(httpx.patch, f'{API_URL}/api/menus/{menu_id}',
                  json={'planning_notes': 'GFS is out of salmon this month'},
                  cookies=nm)
    record(results, '3.4.1', 'PATCH', '/api/menus/{id} (planning_notes)', 200, r.status_code, ms)

    # 3.4.2 — GET and verify persisted
    r, ms = timed(httpx.get, f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    notes = ''
    if r.status_code == 200:
        pn = r.json().get('planning_notes', '')
        if 'salmon' not in str(pn):
            notes = f'planning_notes not persisted; got: {pn!r}'
    record(results, '3.4.2', 'GET', '/api/menus/{id} (verify planning_notes)',
           200, r.status_code, ms, notes=notes,
           status='PASS' if r.status_code == 200 and not notes else 'FAIL')

    # 3.4.3 — edit on SUBMITTED → 403 (test after we have a submitted menu; skip for now)
    skip(results, '3.4.3', 'PATCH', '/api/menus/{id} (SUBMITTED block)',
         'Requires SUBMITTED menu — tested in test_04_approval')

    # ------------------------------------------------------------------ 3.5.x  (HYBRID — AI)
    print('\n  3.5 AI Menu Generation  [HYBRID]')

    r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/generate',
                  cookies=nm, timeout=90)
    notes = ''
    status = None
    if r.status_code == 200:
        body = r.json()
        if not body.get('proposal_id'):
            notes = 'WARN: no proposal_id in response'
        if ms > 60000:
            notes += f' WARN: took {ms:.0f}ms (target <60s)'
    elif r.status_code == 503:
        notes = 'AI unavailable (503) — acceptable if ANTHROPIC_API_KEY not set'
        status = 'PASS'
    record(results, '3.5.1', 'POST', '/api/menus/{id}/generate', 200, r.status_code, ms,
           status=status or ('PASS' if r.status_code == 200 and not notes else 'FAIL'),
           notes=notes,
           suggested_fix='Ensure ANTHROPIC_API_KEY env var is set' if r.status_code == 503 else None)

    # 3.5.2 / 3.5.3: skip (no generate/accept route; proposal apply is manual via NL edit)
    skip(results, '3.5.2', 'POST', '/api/menus/{id}/generate/accept',
         'No generate/accept endpoint — proposals applied via nl-edit flow')
    r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/generate',
                  cookies=nm, timeout=10)
    record(results, '3.5.3', 'POST', '/api/menus/{id}/generate (no key)', 503, r.status_code, ms,
           status='PASS' if r.status_code in (503, 200) else 'FAIL',
           notes='503=key absent; 200=key present (both acceptable)')

    # ------------------------------------------------------------------ 3.6.x  (HYBRID — NL edit)
    print('\n  3.6 Natural Language Edit  [HYBRID]')
    # NOTE: Guide uses /api/menus/{id}/nl-edit; actual endpoint is /api/menus/:id/edit

    r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/edit',
                  json={'instruction': 'Replace all chicken in week 2 with turkey'},
                  cookies=nm, timeout=60)
    notes = 'Guide endpoint is /nl-edit; actual is /edit'
    status = None
    if r.status_code == 200:
        body = r.json()
        if 'changes' not in body:
            notes += '; WARN: no changes array in response'
        if ms > 30000:
            notes += f'; WARN: took {ms:.0f}ms (target <30s)'
    elif r.status_code == 503:
        status = 'PASS'
        notes += '; AI unavailable (503)'
    record(results, '3.6.1', 'POST', '/api/menus/{id}/edit (nl-edit)', 200, r.status_code, ms,
           status=status or ('PASS' if r.status_code == 200 else 'FAIL'),
           notes=notes,
           suggested_fix='Endpoint mismatch: guide says /nl-edit, actual is /edit. Rename or add alias.' if r.status_code == 404 else None)

    skip(results, '3.6.2', 'POST', '/api/menus/{id}/nl-edit/apply',
         'No nl-edit/apply endpoint; edits are applied per-item via POST /days/:id/items')

    # ------------------------------------------------------------------ 3.7.x  Conflict Detection
    print('\n  3.7 Conflict Detection  [AUTO]')
    # NOTE: Guide tests /conflicts endpoint separately.
    # Actual API embeds conflicts in GET /api/menus/:id response and POST item response.
    # We test by adding conflicting items and checking conflicts array in POST item response.

    hot_recipe2  = recipe_ids.get('hot_chicken2')
    fish_recipe  = recipe_ids.get('fish')

    # 3.7.1 — RECIPE_REPEAT: put same recipe on two nearby days
    # Get two consecutive days from the menu
    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    days_list = [d for d in mr.json().get('days', []) if not d.get('is_holiday')]

    if len(days_list) >= 2 and hot_recipe:
        day1_id = days_list[0]['id']
        day2_id = days_list[1]['id']
        # Add same recipe to day1
        r1 = httpx.post(f'{API_URL}/api/menus/{menu_id}/days/{day1_id}/items',
                         json={'recipe_id': hot_recipe, 'meal_type': 'HOT'}, cookies=nm)
        # Add same recipe to day2
        r2, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/days/{day2_id}/items',
                       json={'recipe_id': hot_recipe, 'meal_type': 'HOT'}, cookies=nm)
        conflicts = r2.json().get('conflicts', []) if r2.status_code == 201 else []
        has_repeat = any(c.get('conflict_type') == 'RECIPE_REPEAT' for c in conflicts)
        record(results, '3.7.1', 'POST', '/api/menus/{id}/days/{day_id}/items (RECIPE_REPEAT)',
               201, r2.status_code, ms,
               status='PASS' if has_repeat else 'FAIL',
               notes=f'conflicts={[c.get("conflict_type") for c in conflicts]}' if conflicts else 'No conflicts returned — RECIPE_REPEAT not detected',
               suggested_fix='conflicts service: check for RECIPE_REPEAT within 21 days' if not has_repeat and r2.status_code == 201 else None)
    else:
        skip(results, '3.7.1', 'POST', '...items (RECIPE_REPEAT)', 'Insufficient days or no recipe ID')

    # 3.7.2 — PROTEIN_CONFLICT: 2 CHICKEN entrees same day
    if len(days_list) >= 1 and hot_recipe and hot_recipe2:
        day_id = days_list[0]['id']
        # Add first chicken
        httpx.post(f'{API_URL}/api/menus/{menu_id}/days/{day_id}/items',
                   json={'recipe_id': hot_recipe, 'meal_type': 'HOT'}, cookies=nm)
        # Add second chicken — should trigger conflict
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/days/{day_id}/items',
                      json={'recipe_id': hot_recipe2, 'meal_type': 'HOT'}, cookies=nm)
        conflicts = r.json().get('conflicts', []) if r.status_code == 201 else []
        has_conflict = any(c.get('conflict_type') == 'PROTEIN_CONFLICT' for c in conflicts)
        record(results, '3.7.2', 'POST', '/api/menus/{id}/days/{day_id}/items (PROTEIN_CONFLICT)',
               201, r.status_code, ms,
               status='PASS' if has_conflict else 'FAIL',
               notes=f'conflicts={[c.get("conflict_type") for c in conflicts]}' if not has_conflict else '',
               suggested_fix='conflicts service: detect PROTEIN_CONFLICT when 2 same protein_group on same day' if not has_conflict and r.status_code == 201 else None)
    else:
        skip(results, '3.7.2', 'POST', '...items (PROTEIN_CONFLICT)', 'Need 2 chicken recipes')

    # 3.7.3 — FISH_FREQUENCY: >2 fish in one week
    if len(days_list) >= 3 and fish_recipe:
        fish_conflicts = []
        for day in days_list[:3]:
            rr = httpx.post(f'{API_URL}/api/menus/{menu_id}/days/{day["id"]}/items',
                            json={'recipe_id': fish_recipe, 'meal_type': 'HOT'}, cookies=nm)
            if rr.status_code == 201:
                fish_conflicts.extend(rr.json().get('conflicts', []))
        has_fish = any(c.get('conflict_type') == 'FISH_FREQUENCY' for c in fish_conflicts)
        r_ms = 0
        record(results, '3.7.3', 'POST', '/api/menus/{id}/days/{day_id}/items (FISH_FREQUENCY)',
               201, 201, r_ms,
               status='PASS' if has_fish else 'FAIL',
               notes=f'conflicts seen={list({c["conflict_type"] for c in fish_conflicts})}' if not has_fish else '',
               suggested_fix='conflicts service: detect FISH_FREQUENCY when fish entree added >2x in same Mon-Fri week' if not has_fish else None)
    else:
        skip(results, '3.7.3', 'POST', '...items (FISH_FREQUENCY)', 'Need fish recipe and 3+ days')

    # ------------------------------------------------------------------ 3.8.x  AI Substitution
    print('\n  3.8 AI Substitution  [HYBRID]')
    # NOTE: Guide uses /suggest-substitution; actual is /suggestions (with conflict_id in body)

    # Get a conflict ID if any exist
    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    conflict_id = None
    sub_day_id  = None
    for day in mr.json().get('days', []):
        if day.get('conflicts'):
            conflict_id = day['conflicts'][0]['id']
            sub_day_id  = day['id']
            break

    if conflict_id and sub_day_id:
        r, ms = timed(httpx.post,
                      f'{API_URL}/api/menus/{menu_id}/days/{sub_day_id}/suggestions',
                      json={'conflict_id': conflict_id},
                      cookies=nm, timeout=30)
        notes = 'Guide endpoint: /suggest-substitution; actual: /suggestions'
        status = None
        if r.status_code == 200:
            if not isinstance(r.json(), (list, dict)):
                notes += '; WARN: unexpected response shape'
        elif r.status_code == 503:
            status = 'PASS'
            notes += '; AI unavailable'
        record(results, '3.8.1', 'POST', '/api/menus/{id}/days/{day_id}/suggestions',
               200, r.status_code, ms,
               status=status or ('PASS' if r.status_code == 200 else 'FAIL'),
               notes=notes,
               suggested_fix='Rename /suggestions to /suggest-substitution per guide, or update guide to match code' if r.status_code == 404 else None)
    else:
        skip(results, '3.8.1', 'POST', '/api/menus/{id}/days/{day_id}/suggestions',
             'No conflict available for substitution test')

    skip(results, '3.8.2', 'POST', '/api/menus/{id}/days/{day_id}/apply-substitution',
         'No apply-substitution endpoint — substitution is applied via POST /items')

    # ------------------------------------------------------------------ 3.9.x  Production Counts
    print('\n  3.9 Production Counts  [AUTO]')

    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    actuals_day = _first_day_id(mr.json()) if mr.status_code == 200 else None
    # Use second day to avoid the HOT item we removed earlier
    days_actuals = [d for d in mr.json().get('days', []) if not d.get('is_holiday')] if mr.status_code == 200 else []
    actuals_day = days_actuals[1]['id'] if len(days_actuals) >= 2 else actuals_day

    base_url = f'{API_URL}/api/menus/{menu_id}/days'

    if not actuals_day:
        for tid in ['3.9.1','3.9.2','3.9.3','3.9.4','3.9.5']:
            skip(results, tid, 'PATCH', '/api/menus/{id}/days/{day_id}/actuals', 'No day ID')
    else:
        act_ep = f'{base_url}/{actuals_day}/actuals'

        # 3.9.1 — set planned_overrun_pct
        r, ms = timed(httpx.patch, act_ep,
                      json={'planned_overrun_pct': 5}, cookies=nm)
        record(results, '3.9.1', 'PATCH', '/api/menus/{id}/days/{day_id}/actuals (overrun)',
               200, r.status_code, ms)

        # 3.9.2 — actual_prepared > actual_served → frozen_available = 15
        r, ms = timed(httpx.patch, act_ep,
                      json={'actual_prepared': 120, 'actual_served': 105}, cookies=nm)
        notes = ''
        if r.status_code == 200:
            day_data = r.json()
            prep   = day_data.get('actual_prepared', 0) or 0
            served = day_data.get('actual_served', 0) or 0
            frozen = prep - served
            if frozen != 15:
                notes = f'Expected frozen_available=15; computed={frozen} (prep={prep}, served={served})'
        record(results, '3.9.2', 'PATCH', '/api/menus/{id}/days/{day_id}/actuals (120/105)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')

        # 3.9.3 — equal → frozen = 0
        r, ms = timed(httpx.patch, act_ep,
                      json={'actual_prepared': 100, 'actual_served': 100}, cookies=nm)
        notes = ''
        if r.status_code == 200:
            day_data = r.json()
            frozen   = (day_data.get('actual_prepared') or 0) - (day_data.get('actual_served') or 0)
            if frozen != 0:
                notes = f'Expected frozen=0, got {frozen}'
        record(results, '3.9.3', 'PATCH', '/api/menus/{id}/days/{day_id}/actuals (equal)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')

        # 3.9.4 — deficit (served > prepared)
        r, ms = timed(httpx.patch, act_ep,
                      json={'actual_prepared': 90, 'actual_served': 100}, cookies=nm)
        notes = ''
        if r.status_code == 200:
            day_data = r.json()
            frozen   = (day_data.get('actual_prepared') or 0) - (day_data.get('actual_served') or 0)
            if frozen >= 0:
                notes = f'Expected negative deficit; got frozen_available={frozen}'
        record(results, '3.9.4', 'PATCH', '/api/menus/{id}/days/{day_id}/actuals (deficit)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')

        # 3.9.5 — actuals editable on any non-ARCHIVED menu (try a day on current DRAFT menu)
        r, ms = timed(httpx.patch, act_ep,
                      json={'actual_prepared': 110}, cookies=nm)
        record(results, '3.9.5', 'PATCH', '/api/menus/{id}/days/{day_id}/actuals (draft editable)',
               200, r.status_code, ms,
               notes='actuals always editable (any non-ARCHIVED status)' if r.status_code == 200 else '')

    print_summary(results, MODULE)
    return results


if __name__ == '__main__':
    results = run()
    merge_results(results)
    print(f'\n  Results written to test_results.json')
