# -*- coding: utf-8 -*-
"""
COA Menu Planner — Test Runner
Runs all [AUTO] test modules in sequence and writes consolidated test_results.json.

Usage:
  cd coa-tests/
  py -3 -X utf8 run_all.py

Or run individual modules:
  py -3 -X utf8 test_01_auth.py
"""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from helpers import save_results, print_summary

SEP = '=' * 60

MODULES = [
    ('test_01_auth',           'Authentication & Session Management'),
    ('test_02_recipes',        'Recipe Management'),
    ('test_03_menu_planning',  'Menu Planning'),
    ('test_04_approval',       'Approval Workflow'),
]


def main():
    print(f'\n{SEP}')
    print('  COA Menu Planner — Full Test Suite')
    print(SEP)

    all_results = []
    module_summaries = []

    for mod_name, mod_label in MODULES:
        try:
            mod = __import__(mod_name)
            t0 = time.perf_counter()
            results = mod.run()
            elapsed = time.perf_counter() - t0

            passed  = sum(1 for r in results if r['status'] == 'PASS')
            failed  = sum(1 for r in results if r['status'] == 'FAIL')
            skipped = sum(1 for r in results if r['status'] == 'SKIP')
            module_summaries.append({
                'module':  mod_name,
                'label':   mod_label,
                'passed':  passed,
                'failed':  failed,
                'skipped': skipped,
                'elapsed': elapsed,
            })
            all_results.extend(results)
        except SystemExit:
            print(f'\n  !! {mod_name} called sys.exit() — aborting run')
            break
        except Exception as exc:
            print(f'\n  !! {mod_name} raised {type(exc).__name__}: {exc}')
            module_summaries.append({
                'module':  mod_name,
                'label':   mod_label,
                'passed':  0,
                'failed':  0,
                'skipped': 0,
                'elapsed': 0,
                'error':   str(exc),
            })

    # Write consolidated results
    save_results(all_results)

    # Final summary
    print(f'\n{SEP}')
    print('  FINAL SUMMARY')
    print(SEP)
    total_pass = total_fail = total_skip = 0
    for s in module_summaries:
        total_pass  += s['passed']
        total_fail  += s['failed']
        total_skip  += s['skipped']
        err_str = f'  ERROR: {s["error"]}' if s.get('error') else ''
        print(f'  {s["label"]:<40} '
              f'PASS:{s["passed"]:>3}  FAIL:{s["failed"]:>3}  SKIP:{s["skipped"]:>3}'
              f'  ({s["elapsed"]:.1f}s){err_str}')
    print(SEP)
    print(f'  TOTAL  PASS:{total_pass:>3}  FAIL:{total_fail:>3}  SKIP:{total_skip:>3}')
    print(SEP)
    print(f'\n  Results written to test_results.json')
    print(f'  Run report_to_linear.py to file Linear issues for all FAILs\n')

    return 0 if total_fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
