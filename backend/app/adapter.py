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

        # Helper to compute confidence
        def compute_confidence(last_verified_str, source_type, is_citizen=False):
            if is_citizen:
                return "self_declared"

            if not last_verified_str:
                return "verified"

            try:
                # Handle YYYY or YYYY-MM-DD
                year = int(str(last_verified_str).split("-")[0])
                age = current_year - year
                if age > 3:
                    return "stale"
                return "verified"
            except (ValueError, TypeError):
                return "verified"

        # RoR Layer
        layers["ror"]["source"] = layers["ror"].get("source", default_dept_sources.get("ror", "revenue_dept"))
        layers["ror"]["last_verified"] = layers["ror"].get("last_verified", raw_record.get("transaction_date", "2022-01-01"))
        layers["ror"]["confidence"] = compute_confidence(layers["ror"]["last_verified"], layers["ror"]["source"])

        # Registration Layer
        layers["registration"]["source"] = layers["registration"].get("source", default_dept_sources.get("registration", "sub_registrar"))
        layers["registration"]["confidence"] = compute_confidence(layers["registration"].get("date"), layers["registration"]["source"])

        # Zoning Layer
        layers["zoning"]["source"] = layers["zoning"].get("source", default_dept_sources.get("zoning", "master_plan"))
        layers["zoning"]["confidence"] = "verified"

        # Building Permit Layer
        layers["building_permit"]["source"] = layers["building_permit"].get("source", default_dept_sources.get("building_permit", "municipal_corp"))
        # Building permit status can be self-declared if pending or citizen request
        layers["building_permit"]["confidence"] = compute_confidence(None, layers["building_permit"]["source"], is_citizen=False)

        # Tax Layer
        layers["tax"]["source"] = layers["tax"].get("source", default_dept_sources.get("tax", "revenue_dept"))
        layers["tax"]["confidence"] = compute_confidence(layers["tax"].get("last_verified"), layers["tax"]["source"])

        # Encumbrance Layer
        layers["encumbrance"]["source"] = layers["encumbrance"].get("source", default_dept_sources.get("encumbrance", "sub_registrar"))
        # Parse boolean active status if passed as string
        if "active" in layers["encumbrance"]:
            active_val = layers["encumbrance"]["active"]
            if isinstance(active_val, str):
                layers["encumbrance"]["active"] = active_val.lower() in ("true", "1", "yes", "y")
        else:
            layers["encumbrance"]["active"] = False
        layers["encumbrance"]["confidence"] = "verified"

adapter_engine = SchemaAdapter()
