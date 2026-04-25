#!/usr/bin/env python3
"""Seed prompt records into the running Prompt Management Service.

Usage:
    python seed_prompts.py [--url http://localhost:8003]

Each record in data/prompts.json that has a `prompt_name` (but no `prompt_id`)
is treated as a seed — it will be POST'd to /prompts if it doesn't exist yet.
Records with an existing `prompt_id` are skipped (already seeded historically).
"""
import json
import sys
import argparse
from pathlib import Path

import requests

SEED_FILE = Path(__file__).parent / "data" / "prompts.json"
DEFAULT_URL = "http://localhost:8003"

REQUIRED = {"prompt_name", "capability_name", "usecase_name", "agent_type", "prompt_type", "template_text"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL, help="Base URL of the Prompt Management Service")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    records = json.loads(SEED_FILE.read_text())

    seeded = 0
    skipped = 0
    for rec in records:
        # Skip legacy records that already have a prompt_id (manually inserted)
        if "prompt_id" in rec:
            skipped += 1
            continue

        missing = REQUIRED - rec.keys()
        if missing:
            print(f"[skip] missing fields {missing} in record: {rec.get('prompt_name', '?')}")
            skipped += 1
            continue

        payload = {
            "prompt_name": rec["prompt_name"],
            "capability_name": rec["capability_name"],
            "usecase_name": rec["usecase_name"],
            "agent_type": rec["agent_type"],
            "prompt_type": rec["prompt_type"],
            "environment": rec.get("environment", "dev"),
            "version": rec.get("version", 1),
            "template_text": rec["template_text"],
            "lifecycle_status": rec.get("lifecycle_status", "draft"),
            "version_status": rec.get("version_status", "draft"),
            "is_active": rec.get("is_active", False),
            "tags": rec.get("tags", []),
        }

        try:
            resp = requests.post(f"{base}/prompts", json=payload, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                print(f"[seeded] {rec['prompt_name']} -> prompt_id={data['prompt']['prompt_id']}")
                seeded += 1
            else:
                print(f"[error] {rec['prompt_name']} -> {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"[error] {rec['prompt_name']} -> {e}")

    print(f"\nDone. seeded={seeded}, skipped={skipped}")


if __name__ == "__main__":
    main()
