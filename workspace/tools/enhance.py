"""Enhance tool for Claude runs and edit-reel: thin wrapper around ReelSmith's engine (worker/enhance.py),
so the app's render, its previews and the skill all use exactly the same filters and checks.

usage: python {{REEL_STUDIO_DIR}}/tools/enhance.py analyze|check|frame|upscale-estimate|upscale ...  (see --help)
REELSMITH_DIR points at the ReelSmith checkout (setup.ps1 fills in the default below).
"""
import os
import runpy
import sys

app = os.environ.get("REELSMITH_DIR") or "{{REELSMITH_DIR}}"
engine = os.path.join(app, "worker", "enhance.py")
if not os.path.exists(engine):
    sys.exit(f"ReelSmith engine not found at {engine}; set REELSMITH_DIR")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.argv[0] = engine
runpy.run_path(engine, run_name="__main__")
