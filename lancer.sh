#!/usr/bin/env bash
# Lancement sous macOS / Linux
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade -r requirements.txt
.venv/bin/python server.py
