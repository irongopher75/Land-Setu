import os

# Rate limits are switched off for the suite. test_security.py turns them on for its own checks.
os.environ.setdefault("RATE_LIMIT_DISABLED", "true")
