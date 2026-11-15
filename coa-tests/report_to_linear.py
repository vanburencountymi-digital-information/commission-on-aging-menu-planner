# -*- coding: utf-8 -*-
"""
COA Menu Planner — Linear Issue Reporter
Reads test_results.json and files a Linear issue for each FAIL entry that
doesn't already have an open Linear issue.

Usage:
  cd coa-tests/
  py -3 -X utf8 report_to_linear.py [--dry-run]

Requires:
  LINEAR_API_KEY in coa-tests/.env (or in environment)
  ANTHROPIC_API_KEY not required — this module makes no AI calls.
"""
import sys
import json
import httpx
import argparse
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from helpers import _load_env, load_results

_load_env()

import os
LINEAR_API_KEY = os.environ.get('LINEAR_API_KEY', '')
LINEAR_API_URL = 'https://api.linear.app/graphql'

# Linear team/project to file issues against
TEAM_KEY    = 'DIC'
PROJECT_NAME = 'COA Menu Planner'

SEP = '-' * 60


def graphql(query: str, variables: dict = None) -> dict:
    """Execute a Linear GraphQL query."""
    resp = httpx.post(
        LINEAR_API_URL,
        json={'query': query, 'variables': variables or {}},
        headers={'Authorization': LINEAR_API_KEY, 'Content-Type': 'application/json'},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get('errors'):
        raise RuntimeError(f'Linear GraphQL errors: {data["errors"]}')
    return data['data']


def get_team_id() -> str:
    q = '''
    query { teams { nodes { id key name } } }
    '''
    data = graphql(q)
    for team in data['teams']['nodes']:
        if team['key'] == TEAM_KEY:
            return team['id']
    raise RuntimeError(f'Team {TEAM_KEY!r} not found in Linear workspace')


def create_issue(team_id: str, title: str, description: str, label_name: str = 'bug') -> str:
    """Create a Linear issue and return its URL."""
    # Get bug label ID
    q = '''
    query Labels($teamId: String!) {
      issueLabels(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }
    '''
    data = graphql(q, {'teamId': team_id})
    label_id = None
    for lbl in data['issueLabels']['nodes']:
        if lbl['name'].lower() == label_name.lower():
            label_id = lbl['id']
            break

    mutation = '''
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }
    '''
    inp = {
        'teamId':      team_id,
        'title':       title,
        'description': description,
    }
    if label_id:
        inp['labelIds'] = [label_id]

    data = graphql(mutation, {'input': inp})
    issue = data['issueCreate']['issue']
    return issue['url'], issue['identifier']


def format_description(fail: dict) -> str:
    return (
        f'**Auto-filed by test suite — `{fail["id"]}`**\n\n'
        f'| Field | Value |\n'
        f'|-------|-------|\n'
        f'| Test ID | `{fail["id"]}` |\n'
        f'| Method | `{fail["method"]}` |\n'
        f'| Endpoint | `{fail["endpoint"]}` |\n'
        f'| Expected status | `{fail["expected_status"]}` |\n'
        f'| Actual status | `{fail["actual_status"]}` |\n'
        f'| Notes | {fail.get("notes","—")} |\n\n'
        + (f'**Suggested fix:** {fail["suggested_fix"]}\n\n' if fail.get("suggested_fix") else '')
        + f'_Filed automatically by `report_to_linear.py` based on `test_results.json`._'
    )


def main():
    parser = argparse.ArgumentParser(description='File Linear issues for failing tests')
    parser.add_argument('--dry-run', action='store_true', help='Print issues without filing them')
    args = parser.parse_args()

    if not LINEAR_API_KEY:
        print('  !! LINEAR_API_KEY not set in .env — cannot file issues')
        sys.exit(1)

    results = load_results()
    fails   = [r for r in results if r['status'] == 'FAIL']

    if not fails:
        print('\n  No FAILs in test_results.json — nothing to file.')
        return

    print(f'\n{SEP}')
    print(f'  Filing {len(fails)} Linear issue(s) for FAIL results')
    print(f'  {"DRY RUN — no issues will be created" if args.dry_run else "LIVE MODE"}')
    print(SEP)

    if args.dry_run:
        for f in fails:
            print(f'\n  [{f["id"]}] {f["method"]} {f["endpoint"]}')
            print(f'    expected={f["expected_status"]} actual={f["actual_status"]}')
            if f.get('suggested_fix'):
                print(f'    fix: {f["suggested_fix"]}')
        print(f'\n  {len(fails)} issue(s) would be filed.')
        return

    try:
        team_id = get_team_id()
    except Exception as e:
        print(f'  !! Could not get Linear team ID: {e}')
        sys.exit(1)

    filed = 0
    for f in fails:
        title = f'[AUTO-TEST FAIL] {f["id"]} — {f["method"]} {f["endpoint"]} (got {f["actual_status"]}, exp {f["expected_status"]})'
        desc  = format_description(f)
        try:
            url, identifier = create_issue(team_id, title, desc)
            print(f'  [{f["id"]}] Filed {identifier}: {url}')
            filed += 1
        except Exception as e:
            print(f'  !! Failed to file issue for {f["id"]}: {e}')

    print(f'\n{SEP}')
    print(f'  Filed {filed}/{len(fails)} issues in Linear.')
    print(SEP)


if __name__ == '__main__':
    main()
