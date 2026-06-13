import os
import sys

# Make the backend package root importable regardless of pytest's cwd.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
