import atexit
import os
import shutil
import sys
import tempfile

# Eigener Datenordner für den ganzen Testlauf — VOR dem ersten Import von `app`.
# Ohne das landeten printloom.db und farm_log.txt im echten backend/db/ (dem
# Ordner, den docker-compose als /app/db einhängt): Im Farm-Log standen dann
# erfundene Notaus- und Stresstest-Zeilen aus den Tests. paths.py liest
# PRINTLOOM_DATA_DIR genau einmal beim Import und hängt db/ und uploads/ darunter.
_TEST_DATA = tempfile.mkdtemp(prefix="printloom-tests-")
os.environ["PRINTLOOM_DATA_DIR"] = _TEST_DATA
atexit.register(shutil.rmtree, _TEST_DATA, ignore_errors=True)

# Make the backend package root importable regardless of pytest's cwd.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
