import os
import csv
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import AdapterPreviewRequest, AdapterPreviewResponse
from app.adapter import adapter_engine

router = APIRouter(prefix="/adapter", tags=["Schema Adapter"])

@router.post("/preview", response_model=AdapterPreviewResponse)
def preview_adapter(req: AdapterPreviewRequest):
    try:
        cfg = adapter_engine.get_config(req.state)
        canonical = adapter_engine.normalize(req.state, req.raw_record)
        return AdapterPreviewResponse(
            state=cfg.get("state", req.state),
            source_format=cfg.get("source_format", "Unknown"),
            canonical=canonical
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/raw-samples")
def get_raw_samples():
    """Returns sample raw records for Tamil Nadu and Chandigarh for frontend adapter live testing."""
    samples = {"TamilNadu": [], "Chandigarh": []}

    tn_csv = "mock_data/tamilnadu_parcels.csv"
    if os.path.exists(tn_csv):
        with open(tn_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            samples["TamilNadu"] = list(reader)

    chd_csv = "mock_data/chandigarh_parcels.csv"
    if os.path.exists(chd_csv):
        with open(chd_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            samples["Chandigarh"] = list(reader)

    return samples
