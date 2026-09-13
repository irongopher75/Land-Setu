#!/usr/bin/env python3
"""
Privileged Firebase Admin CLI Script.
Assigns official governance custom claims (role) to Firebase User UIDs.

Usage:
  python set_firebase_custom_claims.py <USER_UID> <ROLE>

Allowed Roles:
  citizen, village_officer, auditor, state_admin, officer, bank
"""

import sys
import os
import json
try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth, credentials
except ImportError:
    print("Error: 'firebase-admin' package is required to run this script. Run: pip install firebase-admin")
    sys.exit(1)

VALID_ROLES = {"citizen", "village_officer", "auditor", "state_admin", "officer", "bank"}

def main():
    if len(sys.argv) < 3:
        print("Usage: python set_firebase_custom_claims.py <USER_UID> <ROLE>")
        print("Allowed roles:", ", ".join(sorted(VALID_ROLES)))
        sys.exit(1)

    uid = sys.argv[1].strip()
    role = sys.argv[2].strip().lower()

    if role not in VALID_ROLES:
        print(f"Error: Invalid role '{role}'. Must be one of: {sorted(VALID_ROLES)}")
        sys.exit(1)

    if not firebase_admin._apps:
        service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        if service_account:
            firebase_admin.initialize_app(credentials.Certificate(json.loads(service_account)))
        else:
            firebase_admin.initialize_app()

    try:
        user = firebase_auth.get_user(uid)
        print(f"Assigning role '{role}' to user '{user.email or uid}'...")
        firebase_auth.set_custom_user_claims(uid, {"role": role})
        print(f"Success! Custom claim {{'role': '{role}'}} assigned to UID: {uid}")
        print("The user will receive this claim on their next Firebase ID token refresh.")
    except Exception as e:
        print(f"Error setting custom claims: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
