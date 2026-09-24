"""Dispute-risk classifier: loading, scoring and explaining.

WHAT THIS IS. A real scikit-learn model, trained by scripts/train_risk_model.py and saved to risk_model.joblib.
WHAT IT IS NOT. It is not trained on real dispute outcomes. Its labels are a held-out proxy (see features.py)
computed on synthetic demonstration data, including planted fixtures, and there are very few positive examples.
Treat the score as a demonstration of the method, not as evidence about any parcel.
"""
import os
from functools import lru_cache
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np

from app.intelligence.features import FEATURES, DESCRIBE, feature_row

MODEL_PATH = os.path.join(os.path.dirname(__file__), "risk_model.joblib")
CAVEAT = ("Trained on synthetic demonstration data with proxy labels (ownership mismatch or a rejected request), "
          "not on real dispute outcomes. Few labelled examples: read it as a method demonstration.")


class RiskModel:
    def __init__(self, bundle: Dict[str, Any]):
        self.b = bundle
        self.model = bundle["model"]           # sklearn Pipeline (scaler + classifier)
        self.features = bundle["features"]

    def _z(self, x: np.ndarray) -> np.ndarray:
        scaler = self.model.named_steps["scale"]
        return (x - scaler.mean_) / np.where(scaler.scale_ == 0, 1, scaler.scale_)

    def _contributions(self, x: np.ndarray) -> List[Tuple[str, float]]:
        """Per-feature push on the log-odds for this parcel. Exact for logistic regression. For tree models,
        importance times standardised distance from the training mean, which is a guide, not an exact split."""
        scaler = self.model.named_steps["scale"]
        z = (x - scaler.mean_) / np.where(scaler.scale_ == 0, 1, scaler.scale_)
        clf = self.model.named_steps["clf"]
        weights = clf.coef_[0] if hasattr(clf, "coef_") else clf.feature_importances_
        return sorted(zip(self.features, (weights * z).tolist()), key=lambda kv: -abs(kv[1]))

    def score(self, db, parcel, fraud, zoning_anomaly, transactions, encumbrances, requests):
        from app.rules import RuleEngine
        rules = RuleEngine.evaluate_parcel_rules(db, parcel)
        row = feature_row(parcel, rules, fraud, zoning_anomaly, transactions, encumbrances, requests)
        x = np.array([[row[f] for f in self.features]])
        p = float(self.model.predict_proba(x)[0, 1])
        contrib = self._contributions(x[0])
        z = dict(zip(self.features, self._z(x[0]).tolist()))
        # Only cite something this parcel has MORE of than a typical parcel, and that the model links to
        # higher risk. "Having none of X" is never offered as a reason.
        up = [(f, c) for f, c in contrib if c > 0.05 and z[f] > 0][:3]
        drivers = [{"feature": f, "value": row[f], "effect": round(c, 3), "text": DESCRIBE[f](row[f])} for f, c in contrib[:5]]
        if up:
            text = f"{'Higher' if p >= 0.5 else 'Raised'} mainly by " + ", then ".join(DESCRIBE[f](row[f]) for f, _ in up) + "."
        else:
            base = self.b["validation"].get("base_rate", 0)
            text = ("Nothing in this record is above typical in a way the model links to risk."
                    if p <= max(0.5, base * 3) else
                    "The estimate is high, but no single feature of this record stands out; treat it with caution.")
        return round(p, 3), {
            "explanation": text, "drivers": drivers, "features": row, "caveat": CAVEAT,
            "model": {"kind": self.b["kind"], "trained_at": self.b["trained_at"], "examples": self.b["examples"],
                      "positives": self.b["positives"], "validation": self.b["validation"]},
        }

    def importances(self) -> List[Dict[str, Any]]:
        clf = self.model.named_steps["clf"]
        w = clf.coef_[0] if hasattr(clf, "coef_") else clf.feature_importances_
        return [{"feature": f, "weight": round(float(v), 4)} for f, v in sorted(zip(self.features, w), key=lambda kv: -abs(kv[1]))]


@lru_cache(maxsize=1)
def load_model():
    if not os.path.exists(MODEL_PATH):
        return None
    return RiskModel(joblib.load(MODEL_PATH))
