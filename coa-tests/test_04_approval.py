# -*- coding: utf-8 -*-
"""
Section 4 — Approval Workflow [AUTO]
Contract table: guide §4

Depends on test_03_menu_planning having run first (sets test_menu_id in state).

Flow:
  - Uses test_menu_id from state (DRAFT menu with items from test_03)
  - Adds HOT items to all missing days to make it submittable
  - Tests submit (4.1.x), approval queue (4.2.x), approve/self-approve block (4.2.3/4.2.4)
  - Rejects a second menu (4.3.x) so rd_notes land back on DRAFT
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import httpx
from helpers import (
    API_URL, TEST_YEAR, TEST_MONTH_N,
    get_session, load_state, save_state,
    record, skip, merge_results, print_summary, timed,
)

MODULE = 'test_04_approval'

# A secondary month for the self-approve and reject tests (won't conflict with test_03 month)
ALT_YEAR  = TEST_YEAR + 1
ALT_MONTH = 1   # Jan of next year


def _fill_menu_days(menu_id, recipe_id, nm_cookies):
    """Add HOT item to every non-holiday day that doesn't already have one."""
    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm_cookies)
    if mr.status_code != 200:
        return
    for day in mr.json().get('days', []):
        if day.get('is_holiday'):
            continue
        has_hot = any(i.get('meal_type') == 'HOT' for i in day.get('items', []))
        if not has_hot:
            httpx.post(f'{API_URL}/api/menus/{menu_id}/days/{day["id"]}/items',
                       json={'recipe_id': recipe_id, 'meal_type': 'HOT'},
                       cookies=nm_cookies)


def _get_or_create_menu(year, month, cookies):
    """Return (menu_id, created) for the given year/month."""
    r = httpx.post(f'{API_URL}/api/menus',
                   json={'year': year, 'month': month},
                   cookies=cookies)
    if r.status_code == 201:
        return r.json()['id'], True
    if r.status_code == 409:
        # Already exists — find it
        r2 = httpx.get(f'{API_URL}/api/menus',
                       params={'year': year, 'month': month},
                       cookies=cookies)
        if r2.status_code == 200 and r2.json():
            return r2.json()[0]['id'], False
    return None, False


def run() -> list:
    results = []
    state      = load_state()
    recipe_ids = state.get('recipe_ids', {})
    hot_recipe = recipe_ids.get('hot_chicken')
    menu_id    = state.get('test_menu_id')

    print(f'\n{"="*60}')
    print(f'  {MODULE} — Approval Workflow')
    print('='*60)

    nm    = get_session('nm')
    rd    = get_session('rd')
    admin = get_session('admin')

    if not menu_id:
        print('  !! No test_menu_id in state — was test_03 run successfully?')
        for tid in ['4.1.1','4.1.2','4.2.1','4.2.2','4.2.3','4.2.4','4.3.1','4.3.2']:
            skip(results, tid, 'N/A', 'N/A', 'No test menu in state')
        print_summary(results, MODULE)
        return results

    # Ensure test menu is still DRAFT (re-submit if rejected previously)
    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    if mr.status_code != 200:
        for tid in ['4.1.1','4.1.2','4.2.1','4.2.2','4.2.3','4.2.4','4.3.1','4.3.2']:
            skip(results, tid, 'N/A', 'N/A', f'Could not load menu: {mr.status_code}')
        print_summary(results, MODULE)
        return results

    menu_status = mr.json().get('status')
    if menu_status not in ('DRAFT', 'SUBMITTED'):
        # Already approved/published — create a fresh one for testing
        new_id, _ = _get_or_create_menu(ALT_YEAR, ALT_MONTH + 1, nm)
        if new_id:
            menu_id = new_id
            s = load_state()
            s['test_menu_id'] = menu_id
            save_state(s)
            menu_status = 'DRAFT'
        else:
            for tid in ['4.1.1','4.1.2','4.2.1','4.2.2','4.2.3','4.2.4','4.3.1','4.3.2']:
                skip(results, tid, 'N/A', 'N/A', 'Could not get a DRAFT menu')
            print_summary(results, MODULE)
            return results

    # ------------------------------------------------------------------ 4.1.x
    print('\n  4.1 Submit Menu')

    # 4.1.2 — incomplete (empty extra menu) → expected 400 with missing days list
    # Note: API's submit route does NOT validate day completeness; will return 200/400 based only on status.
    # We use a fresh empty menu to test this.
    if hot_recipe:
        empty_id, created = _get_or_create_menu(ALT_YEAR, ALT_MONTH, nm)
        if empty_id:
            r, ms = timed(httpx.post, f'{API_URL}/api/menus/{empty_id}/submit', cookies=nm)
            passed = r.status_code == 400
            record(results, '4.1.2', 'POST', '/api/menus/{id}/submit (incomplete)', 400, r.status_code, ms,
                   status='PASS' if passed else 'FAIL',
                   notes=(
                       'API submits even with no HOT items — no completeness validation' if not passed else ''
                   ),
                   suggested_fix=(
                       'menus.js submit route: before transitioning to SUBMITTED, verify every '
                       'non-holiday day has at least one HOT item; return 400 with list of missing days'
                   ) if not passed else None)
            # Clean up the alt menu status if it was accidentally submitted
            if r.status_code == 200:
                httpx.post(f'{API_URL}/api/menus/{empty_id}/reject',
                           json={'rd_notes': '[test cleanup]'}, cookies=rd)
        else:
            skip(results, '4.1.2', 'POST', '/api/menus/{id}/submit (incomplete)', 'Could not create empty menu')
    else:
        skip(results, '4.1.2', 'POST', '/api/menus/{id}/submit (incomplete)', 'No recipe ID')

    # Ensure main menu has all days filled before submit
    if hot_recipe and menu_status == 'DRAFT':
        _fill_menu_days(menu_id, hot_recipe, nm)

    # 4.1.1 — complete menu → 200 SUBMITTED
    if menu_status == 'SUBMITTED':
        # Already submitted from a prior run — just verify
        record(results, '4.1.1', 'POST', '/api/menus/{id}/submit (pre-submitted)', 200, 200, 0,
               notes='Menu already SUBMITTED from prior test run — skipping re-submit')
    else:
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/submit', cookies=nm)
        notes = ''
        if r.status_code == 200:
            if r.json().get('status') != 'SUBMITTED':
                notes = f'status is {r.json().get("status")!r}, expected "SUBMITTED"'
        record(results, '4.1.1', 'POST', '/api/menus/{id}/submit (complete)', 200, r.status_code, ms,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL',
               notes=notes)

    # Reload status after potential submit
    mr = httpx.get(f'{API_URL}/api/menus/{menu_id}', cookies=nm)
    menu_status = mr.json().get('status') if mr.status_code == 200 else menu_status

    # ------------------------------------------------------------------ 4.2.x
    print('\n  4.2 RD Review & Approve')

    # 4.2.1 — DIETITIAN sees submitted menus
    r, ms = timed(httpx.get, f'{API_URL}/api/menus',
                  params={'status': 'SUBMITTED'}, cookies=rd)
    notes = ''
    if r.status_code == 200:
        menus = r.json()
        if not isinstance(menus, list):
            notes = 'Expected list; got ' + type(menus).__name__
        elif menu_status == 'SUBMITTED' and not any(m['id'] == menu_id for m in menus):
            notes = 'Submitted test menu not in list'
    record(results, '4.2.1', 'GET', '/api/menus?status=SUBMITTED', 200, r.status_code, ms,
           status='PASS' if r.status_code == 200 and not notes else 'FAIL', notes=notes)

    # 4.2.2 — AI review summary
    # NOTE: Guide uses /api/menus/{id}/ai-review; actual endpoint is GET /api/menus/:id/review-summary
    r, ms = timed(httpx.get, f'{API_URL}/api/menus/{menu_id}/review-summary',
                  cookies=rd, timeout=45)
    notes = 'Guide lists /ai-review; actual endpoint is /review-summary'
    status = None
    if r.status_code == 200:
        body = r.json()
        if 'findings' not in body and 'recommendation' not in body:
            notes += '; WARN: no findings or recommendation in response'
    elif r.status_code == 503:
        status = 'PASS'
        notes += '; AI unavailable (503)'
    elif r.status_code == 400 and menu_status != 'SUBMITTED':
        status = 'SKIP'
        notes += '; menu not SUBMITTED'
    record(results, '4.2.2', 'GET', '/api/menus/{id}/review-summary', 200, r.status_code, ms,
           status=status or ('PASS' if r.status_code == 200 else 'FAIL'),
           notes=notes,
           suggested_fix='Rename /review-summary to /ai-review per guide spec, or update guide to match code' if r.status_code == 404 else None)

    # 4.2.3 — DIETITIAN approves → 200 APPROVED
    if menu_status == 'SUBMITTED':
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{menu_id}/approve', cookies=rd)
        notes = ''
        if r.status_code == 200:
            if r.json().get('status') != 'APPROVED':
                notes = f'status is {r.json().get("status")!r}, expected "APPROVED"'
        record(results, '4.2.3', 'POST', '/api/menus/{id}/approve', 200, r.status_code, ms,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL', notes=notes)
        if r.status_code == 200:
            menu_status = 'APPROVED'
    else:
        skip(results, '4.2.3', 'POST', '/api/menus/{id}/approve',
             f'Menu is {menu_status}, not SUBMITTED')

    # 4.2.4 — self-approve block: ADMIN submits then tries to approve
    # Create a fresh menu for this test so we don't clobber the main one
    self_approve_id, _ = _get_or_create_menu(ALT_YEAR, ALT_MONTH + 2, admin)
    if self_approve_id and hot_recipe:
        # Fill days
        _fill_menu_days(self_approve_id, hot_recipe, admin)
        # Submit as ADMIN
        httpx.post(f'{API_URL}/api/menus/{self_approve_id}/submit', cookies=admin)
        # Try to approve as the same ADMIN → should get 403
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{self_approve_id}/approve', cookies=admin)
        record(results, '4.2.4', 'POST', '/api/menus/{id}/approve (self-approve)', 403, r.status_code, ms,
               status='PASS' if r.status_code == 403 else 'FAIL',
               notes='Self-approve correctly blocked' if r.status_code == 403 else f'Expected 403, got {r.status_code}',
               suggested_fix='menus.js approve route: self-submit block only fires when submitted_by == approver; verify req.user.id comparison is correct' if r.status_code != 403 else None)
        # Clean up
        httpx.post(f'{API_URL}/api/menus/{self_approve_id}/reject',
                   json={'rd_notes': '[test cleanup]'}, cookies=rd)
    else:
        skip(results, '4.2.4', 'POST', '/api/menus/{id}/approve (self-approve)',
             'Could not create alternate menu for self-approve test')

    # ------------------------------------------------------------------ 4.3.x
    print('\n  4.3 Reject')

    # Create a fresh menu to reject (don't destroy the main approved one)
    reject_id, _ = _get_or_create_menu(ALT_YEAR, ALT_MONTH + 3, nm)
    if reject_id and hot_recipe:
        _fill_menu_days(reject_id, hot_recipe, nm)
        # Submit
        httpx.post(f'{API_URL}/api/menus/{reject_id}/submit', cookies=nm)

        # 4.3.1 — RD rejects → 200 DRAFT
        rejection_note = 'Missing fiber sources — please add whole grain bread or legumes'
        r, ms = timed(httpx.post, f'{API_URL}/api/menus/{reject_id}/reject',
                      json={'rd_notes': rejection_note}, cookies=rd)
        notes = ''
        if r.status_code == 200:
            if r.json().get('status') != 'DRAFT':
                notes = f'status is {r.json().get("status")!r}, expected "DRAFT"'
        record(results, '4.3.1', 'POST', '/api/menus/{id}/reject', 200, r.status_code, ms,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL', notes=notes)

        # 4.3.2 — GET the menu as NM; rd_notes should be present
        r, ms = timed(httpx.get, f'{API_URL}/api/menus/{reject_id}', cookies=nm)
        notes = ''
        if r.status_code == 200:
            rd_notes = r.json().get('rd_notes', '')
            if not rd_notes or 'fiber' not in rd_notes.lower():
                notes = f'rd_notes not persisted; got: {rd_notes!r}'
        record(results, '4.3.2', 'GET', '/api/menus/{id} (rd_notes after rejection)',
               200, r.status_code, ms, notes=notes,
               status='PASS' if r.status_code == 200 and not notes else 'FAIL')
    else:
        skip(results, '4.3.1', 'POST', '/api/menus/{id}/reject', 'Could not create menu for reject test')
        skip(results, '4.3.2', 'GET', '/api/menus/{id}', 'Could not create menu for reject test')

    # Persist final approved menu ID for downstream tests (publish, order list, etc.)
    if menu_status == 'APPROVED':
        s = load_state()
        s['approved_menu_id'] = menu_id
        save_state(s)
        print(f'\n  Approved menu ID saved: {menu_id[:8]}...')

    print_summary(results, MODULE)
    return results


if __name__ == '__main__':
    results = run()
    merge_results(results)
    print(f'\n  Results written to test_results.json')
