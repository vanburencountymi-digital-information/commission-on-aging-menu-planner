"""
Section 1 — Authentication & Session Management [AUTO]
Contract table: guide §1
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import httpx
from helpers import (
    API_URL, CREDS, get_session,
    record, skip, merge_results, print_summary, timed,
)

MODULE = 'test_01_auth'


def run() -> list:
    results = []
    print(f'\n{"="*60}')
    print(f'  {MODULE} — Authentication & Session Management')
    print('='*60)

    # ------------------------------------------------------------------ 1.1.x
    print('\n  1.1 Login')

    # 1.1.1 — valid ADMIN login
    r, ms = timed(httpx.post, f'{API_URL}/api/auth/login',
                  json={'email': CREDS["admin"][0], 'password': CREDS["admin"][1]})
    notes = ''
    if r.status_code == 200:
        body = r.json()
        if 'role' not in body:
            notes = 'WARN: response missing role field'
    record(results, '1.1.1', 'POST', '/api/auth/login', 200, r.status_code, ms, notes=notes)
    admin_cookies = r.cookies if r.status_code == 200 else None

    # 1.1.2 — wrong password → 401 with specific error message
    # NOTE: API returns {"error":"Invalid credentials"} not "Invalid email or password"
    r, ms = timed(httpx.post, f'{API_URL}/api/auth/login',
                  json={'email': CREDS["admin"][0], 'password': 'WRONGPASSWORD'})
    body_ok = False
    notes = ''
    if r.status_code == 401:
        body = r.json()
        expected_msg = 'Invalid email or password'
        actual_msg   = body.get('error', '')
        if expected_msg.lower() in actual_msg.lower():
            body_ok = True
        else:
            notes = (f'Status correct but error message mismatch. '
                     f'Expected "{expected_msg}", got "{actual_msg}"')
    status = 'PASS' if r.status_code == 401 and not notes else ('FAIL' if notes else None)
    record(results, '1.1.2', 'POST', '/api/auth/login', 401, r.status_code, ms,
           status=status,
           notes=notes,
           suggested_fix=(
               'auth.js line 21/24: change error message from "Invalid credentials" '
               'to "Invalid email or password" to match spec'
               if notes else None
           ))

    # 1.1.3 — empty body → 400
    r, ms = timed(httpx.post, f'{API_URL}/api/auth/login', json={})
    record(results, '1.1.3', 'POST', '/api/auth/login', 400, r.status_code, ms)

    # 1.1.4 — GET /api/auth/me with valid session
    if admin_cookies:
        r, ms = timed(httpx.get, f'{API_URL}/api/auth/me', cookies=admin_cookies)
        notes = ''
        if r.status_code == 200:
            body = r.json()
            if 'role' not in body:
                notes = 'WARN: response missing role field'
        record(results, '1.1.4', 'GET', '/api/auth/me', 200, r.status_code, ms, notes=notes)
    else:
        skip(results, '1.1.4', 'GET', '/api/auth/me', 'Skipped: admin login failed in 1.1.1')

    # ------------------------------------------------------------------ 1.2.x
    print('\n  1.2 Logout')

    # 1.2.1 — logout clears cookie
    if admin_cookies:
        r, ms = timed(httpx.post, f'{API_URL}/api/auth/logout', cookies=admin_cookies)
        record(results, '1.2.1', 'POST', '/api/auth/logout',
               200, r.status_code, ms,
               notes='204 also acceptable' if r.status_code == 204 else '',
               status='PASS' if r.status_code in (200, 204) else 'FAIL')
    else:
        skip(results, '1.2.1', 'POST', '/api/auth/logout', 'Skipped: no admin session')

    # 1.2.2 — GET /api/menus with NO cookie → expect 401 or 302
    # NOTE: GET /api/menus has no requireAuth in menus.js — this will return 200 (FAIL)
    r, ms = timed(httpx.get, f'{API_URL}/api/menus', follow_redirects=False)
    passed = r.status_code in (401, 302)
    record(results, '1.2.2', 'GET', '/api/menus', 401, r.status_code, ms,
           status='PASS' if passed else 'FAIL',
           notes='Expected 401 or 302; got 200 — GET /api/menus has no requireAuth' if not passed else '',
           suggested_fix=(
               'menus.js: add requireAuth() (any authenticated user) to GET / route '
               'so unauthenticated requests are rejected'
               if not passed else None
           ))

    # ------------------------------------------------------------------ 1.3.x
    print('\n  1.3 Role-Based Access')

    kitchen_cookies = get_session('kitchen')
    nm_cookies      = get_session('nm')
    rd_cookies      = get_session('rd')
    admin_cookies   = get_session('admin')

    # 1.3.1 — KITCHEN GET /api/auth/me → 200, role==KITCHEN_STAFF
    r, ms = timed(httpx.get, f'{API_URL}/api/auth/me', cookies=kitchen_cookies)
    notes = ''
    if r.status_code == 200:
        role = r.json().get('role')
        if role != 'KITCHEN_STAFF':
            notes = f'role is "{role}", expected "KITCHEN_STAFF"'
    record(results, '1.3.1', 'GET', '/api/auth/me', 200, r.status_code, ms,
           status='PASS' if r.status_code == 200 and not notes else 'FAIL',
           notes=notes)

    # 1.3.2 — KITCHEN GET /api/menus → 403
    # NOTE: menus.js GET / has no requireAuth, so KITCHEN gets 200 (FAIL)
    r, ms = timed(httpx.get, f'{API_URL}/api/menus', cookies=kitchen_cookies)
    passed = r.status_code == 403
    record(results, '1.3.2', 'GET', '/api/menus', 403, r.status_code, ms,
           status='PASS' if passed else 'FAIL',
           notes='GET /api/menus has no requireAuth — KITCHEN should be denied' if not passed else '',
           suggested_fix=(
               'menus.js: add requireAuth("NUTRITION_MANAGER","ADMIN","DIETITIAN") '
               'to the GET / list route to block KITCHEN_STAFF'
               if not passed else None
           ))

    # 1.3.3 — DIETITIAN GET /api/menus → 200
    r, ms = timed(httpx.get, f'{API_URL}/api/menus', cookies=rd_cookies)
    record(results, '1.3.3', 'GET', '/api/menus', 200, r.status_code, ms)

    # 1.3.4 — DIETITIAN POST /api/menus → 403
    r, ms = timed(httpx.post, f'{API_URL}/api/menus',
                  json={'year': 2099, 'month': 1},
                  cookies=rd_cookies)
    record(results, '1.3.4', 'POST', '/api/menus', 403, r.status_code, ms)

    # 1.3.5 — NM GET /api/users → 403
    r, ms = timed(httpx.get, f'{API_URL}/api/users', cookies=nm_cookies)
    record(results, '1.3.5', 'GET', '/api/users', 403, r.status_code, ms)

    # 1.3.6 — ADMIN GET /api/users → 200
    r, ms = timed(httpx.get, f'{API_URL}/api/users', cookies=admin_cookies)
    notes = ''
    if r.status_code == 200:
        users = r.json()
        if not isinstance(users, list):
            notes = 'WARN: expected list, got ' + type(users).__name__
    record(results, '1.3.6', 'GET', '/api/users', 200, r.status_code, ms, notes=notes)

    print_summary(results, MODULE)
    return results


if __name__ == '__main__':
    results = run()
    merge_results(results)
    print(f'\n  Results written to test_results.json')
