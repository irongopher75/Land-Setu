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
    """Returns sample raw records for all configured states for frontend adapter live testing."""
    samples = {}
    
    # Pre-canned fallback mock samples for all states if CSV files are absent
    default_samples = {
        "TamilNadu": [{
            "pattadar_peyar": "R. Kannan",
            "khatha_num": "KH-1187",
            "extent_hectares": "0.0452",
            "patta_type": "record_of_rights",
            "transaction_ref": "REG-2019-88213",
            "transaction_date": "2019-03-14",
            "land_use_code": "residential",
            "fsi_permitted": "1.5",
            "permit_ref": "BP-2022-441",
            "permit_status": "approved",
            "approved_fsi": "1.5",
            "tax_annual_value": "42000",
            "tax_last_updated": "2016-01-01",
            "encumbrance_flag": "false"
        }],
        "Chandigarh": [{
            "owner_full_name": "Sardar Gurpreet Singh",
            "record_no": "CHD-SEC-17-994",
            "area_sqyd": "540",
            "ownership_type": "100% Freehold",
            "deed_number": "CHD-REG-2021-0091",
            "deed_date": "2021-08-20",
            "zone_category": "commercial",
            "max_fsi": "2.0",
            "building_license_no": "CHD-BL-2022-108",
            "license_status": "approved",
            "approved_fsi": "1.8",
            "property_tax_value": "95000",
            "tax_year": "2023-04-01",
            "mortgage_status": "false"
        }],
        "Maharashtra": [{
            "khatedar_nama": "Devendra Sharad Fadnavis",
            "seven_twelve_no": "MH-712-4491",
            "kshetra_guntha": "4.5",
            "dharan_adhikar": "Klass-1 Bhoodhari",
            "dast_kramank": "MH-PUNE-2020-5512",
            "dast_dinank": "2020-11-12",
            "vaprache_swaroop": "residential",
            "prapata_fsi": "1.75",
            "parvanagi_kramank": "PMC-BP-2021-88",
            "parvanagi_sthiti": "approved",
            "swikrut_fsi": "1.75",
            "kar_aakarani_rs": "58000",
            "kar_kalam_varsh": "2022-03-31",
            "boja_nond": "false"
        }],
        "Karnataka": [{
            "hissadar_hesaru": "Siddaramaiah K",
            "rtc_survey_no": "KA-RTC-8821",
            "area_sqft": "4800",
            "hakku_type": "Permanent Owner",
            "kraya_patra_no": "KA-BLR-2022-991",
            "kraya_dina": "2022-05-19",
            "land_bhavan_code": "commercial",
            "anumathi_fsi": "2.25",
            "kattida_permitee_no": "BBMP-BP-2023-11",
            "permitee_status": "approved",
            "sanctioned_fsi": "2.0",
            "swathu_therige_rs": "112000",
            "therige_varsha": "2023-01-01",
            "sala_boja_flag": "false"
        }],
        "Delhi": [{
            "khatauni_owner": "Rajesh Kumar Sharma",
            "khasra_number": "DL-DDA-4402",
            "area_sqmeter": "350",
            "holding_type": "Leasehold to Freehold",
            "registry_token_no": "DL-REG-2021-4410",
            "registry_date": "2021-09-30",
            "master_plan_zone": "residential",
            "norm_fsi": "2.0",
            "mcd_sanction_no": "MCD-BP-2022-990",
            "mcd_status": "approved",
            "sanctioned_fsi": "2.0",
            "property_tax_annual": "74000",
            "tax_assessment_year": "2022-04-01",
            "lien_mortgage_status": "false"
        }],
        "Telangana": [{
            "pattadar_namam": "K. Chandrashekar Rao",
            "dharani_passbook_no": "TG-DHR-5521",
            "extent_acres": "0.12",
            "pattadar_hakku": "Absolute Ownership",
            "sale_deed_doc_no": "TG-HYD-2021-3312",
            "registration_date": "2021-06-15",
            "zone_type": "residential",
            "permitted_fsi": "2.5",
            "ghmc_permit_no": "GHMC-BP-2022-771",
            "permit_status": "approved",
            "approved_fsi": "2.2",
            "property_tax_amount": "88000",
            "tax_paid_date": "2023-02-10",
            "encumbrance_status": "false"
        }],
        "Kerala": [{
            "udama_peru": "V. S. Achuthanandan",
            "thandaper_no": "KL-TP-9921",
            "extent_ares": "3.8",
            "avakasam_type": "Janmam",
            "aadhar_no": "KL-TVM-2020-4491",
            "registered_date": "2020-10-05",
            "upayoga_vibhagam": "residential",
            "anuvadichitta_fsi": "1.5",
            "building_permit_no": "KMC-BP-2021-302",
            "permit_status": "approved",
            "approved_fsi": "1.5",
            "kudissika_tax_rs": "36000",
            "tax_year": "2022-01-01",
            "kadam_puyapadu": "false"
        }],
        "WestBengal": [{
            "raiyat_naam": "Mamata Banerjee",
            "khatian_no": "WB-KH-7741",
            "area_decimal": "12.5",
            "swatwa_type": "Raiyati",
            "dalil_number": "WB-KOL-2021-8891",
            "dalil_date": "2021-12-01",
            "bhumir_shreni": "commercial",
            "anumita_fsi": "2.0",
            "kmc_sanction_no": "KMC-BP-2022-104",
            "sanction_status": "approved",
            "approved_fsi": "2.0",
            "municipality_tax_rs": "65000",
            "tax_year": "2022-04-01",
            "daya_mortgage_flag": "false"
        }],
        "Gujarat": [{
            "khatedar_naam": "Vijay Rupani",
            "khata_number": "GJ-712-8831",
            "khetar_are_sqm": "420",
            "hakk_prakar": "Niyamit Vahat",
            "dastavej_no": "GJ-AMD-2020-1102",
            "dastavej_tarikh": "2020-04-18",
            "jameen_hetu": "residential",
            "manjur_fsi": "1.8",
            "raba_mandoor_no": "AMC-BP-2021-992",
            "mandoor_status": "approved",
            "mandoor_fsi": "1.8",
            "kar_rakam_rs": "49000",
            "tax_aakhri_varsh": "2021-03-31",
            "boja_vigat": "false"
        }],
        "Rajasthan": [{
            "khatedar_naam": "Ashok Gehlot",
            "khatauni_no": "RJ-APN-5510",
            "area_bigha": "0.18",
            "khatedari_type": "Pukka Khatedar",
            "sale_deed_no": "RJ-JAI-2021-6601",
            "deed_date": "2021-07-22",
            "land_category": "residential",
            "permitted_fsi": "1.6",
            "patta_permit_no": "JDA-BP-2022-401",
            "permit_status": "approved",
            "sanctioned_fsi": "1.5",
            "property_tax_rs": "38000",
            "tax_paid_year": "2022-03-31",
            "girvi_status": "false"
        }],
        "UttarPradesh": [{
            "khatedar_naam": "Yogi Adityanath",
            "khatauni_khata_no": "UP-KHT-9901",
            "area_hectare": "0.052",
            "bhumidhari_rights": "Bhumidhar with Transferable Rights",
            "sub_registrar_deed_no": "UP-LKN-2020-7712",
            "deed_execution_date": "2020-08-14",
            "viniyog_land_use": "residential",
            "lda_permitted_fsi": "1.75",
            "naksha_swikriti_no": "LDA-BP-2021-550",
            "naksha_status": "approved",
            "swikrit_fsi": "1.75",
            "grah_kar_rs": "52000",
            "tax_year": "2022-04-01",
            "bandhak_mortgage_flag": "false"
        }],
        "Punjab": [{
            "malik_naam": "Bhagwant Mann",
            "khewat_no": "PB-KHW-3341",
            "raqba_marla": "18.0",
            "hissa_share": "1/1 Share",
            "wasika_no": "PB-ASR-2021-5501",
            "wasika_date": "2021-03-10",
            "khasra_use": "residential",
            "manzoor_far": "1.65",
            "naksha_pass_no": "MC-ASR-2022-801",
            "naksha_status": "approved",
            "naksha_far": "1.65",
            "property_tax_rs": "44000",
            "tax_aakhri_saal": "2022-04-01",
            "rehn_rahan_flag": "false"
        }],
        "MadhyaPradesh": [{
            "bhoomi_swami": "Shivraj Singh Chouhan",
            "khata_kramank": "MP-BHL-1092",
            "kshetrafal_hec": "0.048",
            "hissa_anash": "1/1 Purna",
            "panjiyan_kramank": "MP-BPL-2020-4490",
            "panjiyan_tithi": "2020-09-01",
            "bhoomi_prayojan": "residential",
            "maney_fsi": "1.5",
            "anumati_kramank": "BMC-BP-2021-662",
            "anumati_sthiti": "approved",
            "swikrit_fsi": "1.5",
            "varshik_kar": "41000",
            "kar_bhugtan_varsh": "2021-04-01",
            "bandhak_sthiti": "false"
        }]
    }

    # Load from CSV if present, else default
    tn_csv = "mock_data/tamilnadu_parcels.csv"
    if os.path.exists(tn_csv):
        with open(tn_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            samples["TamilNadu"] = list(reader)
    else:
        samples["TamilNadu"] = default_samples["TamilNadu"]

    chd_csv = "mock_data/chandigarh_parcels.csv"
    if os.path.exists(chd_csv):
        with open(chd_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            samples["Chandigarh"] = list(reader)
    else:
        samples["Chandigarh"] = default_samples["Chandigarh"]

    # Include all other state defaults
    for st, recs in default_samples.items():
        if st not in samples:
            samples[st] = recs

    return samples
