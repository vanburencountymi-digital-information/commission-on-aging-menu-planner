# -*- coding: utf-8 -*-
"""Shared helpers for COA Menu Planner automated tests."""
import json
import os
import sys
import time
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent

def _load_env():
    env_file = _HERE / '.env'
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

_load_env()

API_URL       = os.environ.get('API_URL', 'http://localhost:3001')
TEST_MONTH    = os.environ.get('TEST_MONTH', '2026-08')
TEST_YEAR     = int(TEST_MONTH.split('-')[0])
TEST_MONTH_N  = int(TEST_MONTH.split('-')[1])

CREDS = {
    'admin':   (os.environ.get('TEST_ADMIN_EMAIL'),   os.environ.get('TEST_ADMIN_PASSWORD')),
    'nm':      (os.environ.get('TEST_NM_EMAIL'),       os.environ.get('TEST_NM_PASSWORD')),
    'rd':      (os.environ.get('TEST_RD_EMAIL'),       os.environ.get('TEST_RD_PASSWORD')),
    'kitchen': (os.environ.get('TEST_KITCHEN_EMAIL'),  os.environ.get('TEST_KITCHEN_PASSWORD')),
}

# ---------------------------------------------------------------------------
# State file — shared recipe/menu IDs between test modules
# ---------------------------------------------------------------------------
STATE_FILE   = _HERE / 'test_state.json'
RESULTS_FILE = _HERE / 'test_results.json'

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}

def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))

# ---------------------------------------------------------------------------
# Session helper
# ---------------------------------------------------------------------------
def get_session(role: str) -> httpx.Cookies:
    email, password = CREDS[role]
    r = httpx.post(f'{API_URL}/api/auth/login',
                   json={'email': email, 'password': password},
                   follow_redirects=False)
    if r.status_code != 200:
        print(f'  !! Login failed for {role} ({email}): {r.status_code} {r.text}', file=sys.stderr)
        sys.exit(1)
    return r.cookies

# ---------------------------------------------------------------------------
# Results helpers
# ---------------------------------------------------------------------------
def load_results() -> list:
    if RESULTS_FILE.exists():
        return json.loads(RESULTS_FILE.read_text())
    return []

def save_results(results: list):
    RESULTS_FILE.write_text(json.dumps(results, indent=2))

def merge_results(new_results: list):
    """Load existing results, replace entries with same ID, save."""
    existing = load_results()
    new_ids = {r['id'] for r in new_results}
    kept = [r for r in existing if r['id'] not in new_ids]
    combined = kept + new_results
    combined.sort(key=lambda r: r['id'])
    save_results(combined)
    return combined

def record(
    results: list,
    test_id: str,
    method: str,
    endpoint: str,
    expected_status: int,
    actual_status: int,
    duration_ms: float,
    *,
    status: str = None,
    notes: str = '',
    suggested_fix: str = None,
    body_check: bool = True,   # set False to skip body assert in caller
) -> dict:
    if status is None:
        status = 'PASS' if actual_status == expected_status else 'FAIL'
    entry = {
        'id':              test_id,
        'status':          status,
        'method':          method,
        'endpoint':        endpoint,
        'expected_status': expected_status,
        'actual_status':   actual_status,
        'duration_ms':     round(duration_ms),
        'notes':           notes,
    }
    if suggested_fix:
        entry['suggested_fix'] = suggested_fix
    results.append(entry)
    icon = '✓' if status == 'PASS' else ('S' if status == 'SKIP' else '✗')
    extra = f'  — {notes}' if notes else ''
    print(f'  [{icon}] {test_id:<8} {method:<7} {endpoint:<55} {actual_status} (exp {expected_status}){extra}')
    return entry

def skip(results: list, test_id: str, method: str, endpoint: str, reason: str) -> dict:
    return record(results, test_id, method, endpoint, 0, 0, 0,
                  status='SKIP', notes=reason)

# ---------------------------------------------------------------------------
# Timed request wrapper
# ---------------------------------------------------------------------------
def timed(fn, *args, **kwargs):
    """Call fn(*args, **kwargs), return (response, duration_ms)."""
    t0 = time.perf_counter()
    r = fn(*args, **kwargs)
    return r, (time.perf_counter() - t0) * 1000

# ---------------------------------------------------------------------------
# Summary printer
# ---------------------------------------------------------------------------
def print_summary(results: list, module_name: str = ''):
    passed = sum(1 for r in results if r['status'] == 'PASS')
    failed = sum(1 for r in results if r['status'] == 'FAIL')
    skipped = sum(1 for r in results if r['status'] == 'SKIP')
    print(f'\n{"="*60}')
    if module_name:
        print(f'  {module_name}')
    print(f'  PASS: {passed}  FAIL: {failed}  SKIP: {skipped}')
    if failed:
        print('  FAILURES:')
        for r in results:
            if r['status'] == 'FAIL':
                fix = f'  → {r["suggested_fix"]}' if r.get('suggested_fix') else ''
                print(f'    {r["id"]} — {r["method"]} {r["endpoint"]} '
                      f'(got {r["actual_status"]}, exp {r["expected_status"]}){fix}')
    print('='*60)
