import os
import sys

# Make `app` importable and give the internal key a test value before settings load.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
os.environ.setdefault("CORE_SERVICE_URL", "http://core.test")
