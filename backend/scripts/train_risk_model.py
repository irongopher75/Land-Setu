"""Train the dispute-risk classifier and save it to app/intelligence/risk_model.joblib.

    cd backend && python scripts/train_risk_model.py

Builds a fresh, throwaway SQLite database from the seed data and planted fixtures, so every run trains on the
same data whatever is in the live database. Computes features and the held-out proxy label (see
app/intelligence/features.py), compares logistic regression and gradient boosting with leave-one-out
validation, keeps logistic regression unless boosting is clearly better (it explains itself exactly), and
writes the model plus its validation results.

HONESTY NOTE. The labels are a proxy on synthetic data, not adjudicated disputes, and there are few positives.
The validation numbers below are printed so nobody mistakes this for a validated risk model.
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/train.db"
os.environ.setdefault("JWT_SECRET", "training-only-secret-not-used-anywhere-else")
os.environ["ALLOW_SQLITE_FALLBACK"] = "true"

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import GradientBoostingClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import average_precision_score, roc_auc_score  # noqa: E402
from sklearn.model_selection import LeaveOneOut, cross_val_predict  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from app.db import Base, engine, SessionLocal  # noqa: E402
from app.seed import seed_database  # noqa: E402
from app.intelligence.seed_history import backfill_seed_history, plant_fixtures  # noqa: E402
from app.intelligence import service  # noqa: E402
from app.intelligence.features import FEATURES, feature_row, held_out_label  # noqa: E402
from app.intelligence.risk import MODEL_PATH  # noqa: E402
from app.models import (BoundaryChangeRequest, EncumbranceEvent, Parcel, ParcelIntelligence,  # noqa: E402
                        RegistrationTransaction)
from app.rules import RuleEngine  # noqa: E402


def build_dataset():
    Base.metadata.create_all(bind=engine)
    seed_database()
    db = SessionLocal()
    backfill_seed_history(db)
    plant_fixtures(db)
    for (st,) in db.query(Parcel.state).distinct().all():
        service.compute_state(db, st, risk_model=None)
    X, y, ids = [], [], []
    for p in db.query(Parcel).filter(Parcel.status == "active").order_by(Parcel.ulpin).all():
        intel = db.query(ParcelIntelligence).filter_by(ulpin=p.ulpin).one()
        txns = db.query(RegistrationTransaction).filter_by(ulpin=p.ulpin).all()
        encs = db.query(EncumbranceEvent).filter_by(ulpin=p.ulpin).all()
        reqs = db.query(BoundaryChangeRequest).filter_by(ulpin=p.ulpin).all()
        row = feature_row(p, RuleEngine.evaluate_parcel_rules(db, p), intel.fraud_flags, intel.zoning_anomaly, txns, encs, reqs)
        X.append([row[f] for f in FEATURES])
        y.append(held_out_label(p, reqs))
        ids.append(p.ulpin)
    return np.array(X), np.array(y), ids


def candidates():
    return {
        "logistic_regression": Pipeline([("scale", StandardScaler()),
                                         ("clf", LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000))]),
        "gradient_boosting": Pipeline([("scale", StandardScaler()),
                                       ("clf", GradientBoostingClassifier(n_estimators=100, max_depth=2, learning_rate=0.1,
                                                                          random_state=26014))]),
    }


def main():
    X, y, ids = build_dataset()
    positives = int(y.sum())
    print(f"examples={len(y)} positives={positives} (label: ownership mismatch or a rejected request)")
    print("positive parcels:", [u for u, v in zip(ids, y) if v])
    results = {}
    for name, pipe in candidates().items():
        oof = cross_val_predict(pipe, X, y, cv=LeaveOneOut(), method="predict_proba")[:, 1]
        results[name] = {"roc_auc": round(float(roc_auc_score(y, oof)), 3),
                         "average_precision": round(float(average_precision_score(y, oof)), 3),
                         "base_rate": round(positives / len(y), 3)}
        print(name, results[name])
    kind = "logistic_regression"
    if results["gradient_boosting"]["roc_auc"] >= results["logistic_regression"]["roc_auc"] + 0.05:
        kind = "gradient_boosting"
    final = candidates()[kind].fit(X, y)
    bundle = {
        "model": final, "features": FEATURES, "kind": kind,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "examples": int(len(y)), "positives": positives, "sklearn_version": sklearn.__version__,
        "label_definition": "1 if RoR owner differs from deed buyer, or any change request was rejected; else 0",
        "validation": {"method": "leave-one-out, out-of-fold probabilities", **results[kind],
                       "all_candidates": results,
                       "warning": "Few positive examples on synthetic data. These numbers do not validate the model."},
    }
    joblib.dump(bundle, MODEL_PATH)
    print("saved", MODEL_PATH, "kind", kind)
    print(json.dumps(bundle["validation"], indent=2))


if __name__ == "__main__":
    main()
