"""Set the role claim on a LandSetu account.

The server reads the role only from this custom claim (see app/routes/auth.py).
Run with a service account that has Firebase Auth admin rights:

    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
        python scripts/set_role.py demo.officer@landsetu-demo.example village_officer

The account must already exist. It picks up the new role the next time it signs in.
"""
import sys

import firebase_admin
from firebase_admin import auth

ROLES = {"citizen", "village_officer", "auditor", "state_admin"}

if len(sys.argv) != 3 or sys.argv[2] not in ROLES:
    sys.exit(f"usage: set_role.py <email> <{'|'.join(sorted(ROLES))}>")

firebase_admin.initialize_app()
user = auth.get_user_by_email(sys.argv[1])
auth.set_custom_user_claims(user.uid, {"role": sys.argv[2]})
print(f"{user.email} is now {sys.argv[2]}. Sign out and in again to apply.")
