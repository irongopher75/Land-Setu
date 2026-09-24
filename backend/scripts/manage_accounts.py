"""Inspect and manage LandSetu accounts. Run on your own machine with a service-account key.

    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

    python scripts/manage_accounts.py show admin@landsetu.gov.in
        Prints the account and its role claim. This answers "does this account have a role?".

    python scripts/manage_accounts.py set-role <email> <citizen|village_officer|auditor|state_admin>

    python scripts/manage_accounts.py rename <old-email> <new-email>

    python scripts/manage_accounts.py create-demo
        Creates four demo accounts (or updates them if they exist) and sets their roles.
        Set DEMO_PASSWORD to choose the password, otherwise one is generated and printed once.

The server reads the role only from the `role` custom claim (app/routes/auth.py). An account
picks up a new role the next time it signs in. Never commit or share the key file.
"""
import os
import secrets
import sys

import firebase_admin
from firebase_admin import auth

ROLES = ("citizen", "village_officer", "auditor", "state_admin")
DEMO = [
    ("demo.citizen@landsetu-demo.example", "citizen", "Demo Citizen"),
    ("demo.officer@landsetu-demo.example", "village_officer", "Demo Village Officer"),
    ("demo.auditor@landsetu-demo.example", "auditor", "Demo Auditor"),
    ("demo.stateadmin@landsetu-demo.example", "state_admin", "Demo State Administrator"),
]


def show(email):
    u = auth.get_user_by_email(email)
    claims = u.custom_claims or {}
    print(f"email:    {u.email}")
    print(f"uid:      {u.uid}")
    print(f"disabled: {u.disabled}")
    print(f"sign-in:  {', '.join(p.provider_id for p in u.provider_data) or 'none'}")
    print(f"claims:   {claims or '(none)'}")
    role = claims.get("role")
    print(f"role the server will use: {role if role in ROLES else 'citizen (no valid role claim set)'}")


def set_role(email, role):
    if role not in ROLES:
        sys.exit(f"role must be one of {', '.join(ROLES)}")
    u = auth.get_user_by_email(email)
    auth.set_custom_user_claims(u.uid, {"role": role})
    print(f"{email} is now {role}. Sign out and in again to apply.")


def rename(old, new):
    u = auth.get_user_by_email(old)
    auth.update_user(u.uid, email=new)
    print(f"{old} is now {new}. Its role claim is unchanged.")


def create_demo():
    password = os.environ.get("DEMO_PASSWORD") or secrets.token_urlsafe(9)
    for email, role, name in DEMO:
        try:
            u = auth.get_user_by_email(email)
            auth.update_user(u.uid, password=password, display_name=name, email_verified=True)
        except auth.UserNotFoundError:
            u = auth.create_user(email=email, password=password, display_name=name, email_verified=True)
        auth.set_custom_user_claims(u.uid, {"role": role})
        print(f"{role:16} {email}")
    print(f"\npassword for all four: {password}")
    print("Sign in on the Land officer tab (officer roles) or the Citizen tab (citizen).")


if __name__ == "__main__":
    args = sys.argv[1:]
    cmds = {"show": (show, 1), "set-role": (set_role, 2), "rename": (rename, 2), "create-demo": (create_demo, 0)}
    if not args or args[0] not in cmds or len(args) - 1 != cmds[args[0]][1]:
        sys.exit(__doc__)
    firebase_admin.initialize_app()
    cmds[args[0]][0](*args[1:])
