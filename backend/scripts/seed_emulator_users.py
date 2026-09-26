#!/usr/bin/env python3
"""
Dev only. Seeds one Firebase Auth *emulator* user per LandSetu role.

Refuses to run unless FIREBASE_AUTH_EMULATOR_HOST points at a local emulator,
so it can never create users in the real project.

  firebase emulators:start --only auth,firestore
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 python backend/scripts/seed_emulator_users.py

Password: EMULATOR_SEED_PASSWORD if set, otherwise a random one printed once.
"""
import os
import secrets
import sys

import firebase_admin
from firebase_admin import auth

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "landsetu-e4e5e")
ROLES = ["citizen", "village_officer", "auditor", "state_admin", "officer", "bank", "super_admin"]


def main():
    host = os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "")
    if host.split(":")[0] not in ("127.0.0.1", "localhost"):
        sys.exit("Refusing to run: set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 (emulator only).")
    if os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        sys.exit("Refusing to run with real service-account credentials in the environment.")

    firebase_admin.initialize_app(options={"projectId": PROJECT_ID})
    password = os.getenv("EMULATOR_SEED_PASSWORD") or secrets.token_urlsafe(12)

    for role in ROLES:
        email = f"{role.replace('_', '-')}@landsetu.test"
        try:
            user = auth.get_user_by_email(email)
            auth.update_user(user.uid, password=password, email_verified=True)
        except auth.UserNotFoundError:
            user = auth.create_user(email=email, password=password, email_verified=True,
                                    display_name=f"Test {role.replace('_', ' ')}")
        # A citizen gets no role claim, matching how real citizen accounts are created.
        auth.set_custom_user_claims(user.uid, None if role == "citizen" else {"role": role})
        print(f"{role:16} {email}")

    if not os.getenv("EMULATOR_SEED_PASSWORD"):
        print(f"\nPassword for all users (emulator only): {password}")


if __name__ == "__main__":
    main()
