import os
import yaml
from datetime import datetime
from typing import Dict, Any

# Unit conversion registry
CONVERSIONS = {
    "hectares_to_sqm": lambda val: round(float(val) * 10000.0, 2) if val is not None else None,
    "sqyd_to_sqm": lambda val: round(float(val) * 0.836127, 2) if val is not None else None,
    "sqft_to_sqm": lambda val: round(float(val) * 0.092903, 2) if val is not None else None,
    "marla_to_sqm": lambda val: round(float(val) * 25.2929, 2) if val is not None else None,
    "guntha_to_sqm": lambda val: round(float(val) * 101.171, 2) if val is not None else None,
    "bigha_to_sqm": lambda val: round(float(val) * 2529.29, 2) if val is not None else None,
}

# Confidence labels. Only the adapter, importing a department's own record, assigns VERIFIED or STALE.
VERIFIED = "verified"
STALE = "stale"
UNVERIFIED = "unverified"
# An officer-approved correction changed this layer. The change went through review, but no department record
# confirms it, so it is never shown as verified. Re-importing the department's record replaces it.
CORRECTED_BY_OFFICER = "corrected_by_officer"
# Entered by the reviewing officer when approval creates a new parcel that has no department record yet.
# Real, disclosed data, but not a department record, so it is never shown as verified.
OFFICER_PROVIDED = "officer_provided"


class SchemaAdapter:
    def __init__(self, config_dir: str = None):
        if config_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            candidate = os.path.join(base_dir, "configs")
            if os.path.exists(candidate):
                config_dir = candidate
            elif os.path.exists("backend/configs"):
                config_dir = "backend/configs"
            else:
                config_dir = "configs"
        self.config_dir = config_dir
        self.configs: Dict[str, dict] = {}
        self._load_configs()

    def _load_configs(self):
        if not os.path.exists(self.config_dir):
            return
        for file in os.listdir(self.config_dir):
            if file.endswith(".yaml") or file.endswith(".yml"):
                filepath = os.path.join(self.config_dir, file)
                with open(filepath, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f)
                    if cfg and "state" in cfg:
                        # Index by lowercase state name
                        self.configs[cfg["state"].lower()] = cfg

    def get_config(self, state: str) -> dict:
        state_key = state.lower().replace(" ", "").replace("_", "")
        for key, cfg in self.configs.items():
            if key.replace(" ", "").replace("_", "") == state_key:
                return cfg
        raise ValueError(f"No schema adapter configuration found for state: {state}")

    def normalize(self, state: str, raw_record: Dict[str, Any], geometry: Dict[str, Any] = None) -> Dict[str, Any]:
        cfg = self.get_config(state)
        mappings = cfg.get("field_mappings", [])
        default_dept_sources = cfg.get("default_department_sources", {})

        # Canonical Skeleton
        import uuid
        canonical = {
            "ulpin": raw_record.get("ulpin", f"ULPIN-MOCK-{uuid.uuid4().hex[:8].upper()}"),
            "state": cfg.get("state", state),
            "geometry": geometry,
            "area_sqm": None,
            "layers": {
                "ror": {},
                "registration": {},
                "zoning": {},
                "building_permit": {},
                "tax": {},
                "encumbrance": {}
            },
            "flags": []
        }

        # Apply Mappings
        for mapping in mappings:
            src_field = mapping["source_field"]
            target_path = mapping["target"]
            conversion_name = mapping.get("unit_conversion")

            if src_field in raw_record:
                val = raw_record[src_field]
                if conversion_name and conversion_name in CONVERSIONS:
                    val = CONVERSIONS[conversion_name](val)

                # Set nested field in canonical dict
                self._set_nested(canonical, target_path, val)

        # Post-process department layers with metadata & computed confidence
        self._enrich_layers(canonical["layers"], raw_record, default_dept_sources)

        return canonical

    def _set_nested(self, d: dict, path: str, value: Any):
        parts = path.split(".")
        curr = d
        for part in parts[:-1]:
            if part not in curr or not isinstance(curr[part], dict):
                curr[part] = {}
            curr = curr[part]
        curr[parts[-1]] = value

    def _enrich_layers(self, layers: dict, raw_record: dict, default_dept_sources: dict):
        current_year = datetime.now().year

        # Confidence says what the source record supports, nothing more:
        #   unverified  the source record did not supply this layer's value (nothing to attest)
        #   stale       supplied, but last dated more than 3 years ago, or a dated kind of record with no date
        #   verified    supplied by the department's record and current (or a kind of record that carries no date)
        # A value or date this function fills in itself is never labelled verified.
        def compute_confidence(has_value, last_verified_str=None, dated=False):
            if not has_value:
                return "unverified"
            if not last_verified_str:
                return "stale" if dated else "verified"
            try:
                # Handle YYYY or YYYY-MM-DD
                year = int(str(last_verified_str).split("-")[0])
            except (ValueError, TypeError):
                return "unverified"
            return "stale" if current_year - year > 3 else "verified"

        def present(layer, *keys):
            return any(layer.get(k) not in (None, "") for k in keys)

        # RoR Layer. Its verification date is the source's own, or the registered transaction date; never invented.
        ror = layers["ror"]
        ror["source"] = ror.get("source", default_dept_sources.get("ror", "revenue_dept"))
        ror["last_verified"] = ror.get("last_verified") or raw_record.get("transaction_date") or None
        ror["confidence"] = compute_confidence(present(ror, "owner_name", "khata_no"), ror["last_verified"], dated=True)

        # Registration Layer
        reg = layers["registration"]
        reg["source"] = reg.get("source", default_dept_sources.get("registration", "sub_registrar"))
        reg["confidence"] = compute_confidence(present(reg, "last_transaction_id", "buyer_name"), reg.get("date"), dated=True)

        # Zoning Layer
        zoning = layers["zoning"]
        zoning["source"] = zoning.get("source", default_dept_sources.get("zoning", "master_plan"))
        zoning["confidence"] = compute_confidence(present(zoning, "land_use", "permitted_fsi"))

        # Building Permit Layer
        permit = layers["building_permit"]
        permit["source"] = permit.get("source", default_dept_sources.get("building_permit", "municipal_corp"))
        permit["confidence"] = compute_confidence(present(permit, "permit_id", "status"))

        # Tax Layer
        tax = layers["tax"]
        tax["source"] = tax.get("source", default_dept_sources.get("tax", "revenue_dept"))
        tax["confidence"] = compute_confidence(present(tax, "annual_value"), tax.get("last_verified"), dated=True)

        # Encumbrance Layer. An absent status stays unknown (None): "no encumbrance" is a claim only the
        # sub-registrar's record can make.
        enc = layers["encumbrance"]
        enc["source"] = enc.get("source", default_dept_sources.get("encumbrance", "sub_registrar"))
        if "active" in enc and isinstance(enc["active"], str):
            enc["active"] = enc["active"].lower() in ("true", "1", "yes", "y")
        enc.setdefault("active", None)
        enc["confidence"] = compute_confidence(enc["active"] is not None)

adapter_engine = SchemaAdapter()
