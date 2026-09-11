import json
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from shapely.geometry import shape

from app.models import Parcel, ProtectedZone

def parse_geometry_shape(geom_val):
    if isinstance(geom_val, dict):
        return shape(geom_val)
    if isinstance(geom_val, str):
        try:
            return shape(json.loads(geom_val))
        except Exception:
            pass
    try:
        from geoalchemy2.shape import to_shape
        return to_shape(geom_val)
    except Exception:
        pass
    return None

class RuleEngine:
    @staticmethod
    def evaluate_parcel_rules(db: Session, parcel: Parcel) -> List[Dict[str, Any]]:
        flags = []

        # 1. Boundary Overlap Check
        overlap_flag = RuleEngine._check_boundary_overlap(db, parcel)
        if overlap_flag:
            flags.append(overlap_flag)

        # 2. Protected Zone Containment Check
        zone_flag = RuleEngine._check_protected_zone(db, parcel)
        if zone_flag:
            flags.append(zone_flag)

        # 3. Ownership Mismatch Check
        owner_flag = RuleEngine._check_ownership_mismatch(parcel)
        if owner_flag:
            flags.append(owner_flag)

        # 4. Zoning / FSI Violation Check
        fsi_flag = RuleEngine._check_fsi_violation(parcel)
        if fsi_flag:
            flags.append(fsi_flag)

        # 5. Active Encumbrance Disclosure
        encumbrance_flag = RuleEngine._check_encumbrance(parcel)
        if encumbrance_flag:
            flags.append(encumbrance_flag)

        return flags

    @staticmethod
    def _check_boundary_overlap(db: Session, parcel: Parcel) -> Dict[str, Any]:
        try:
            parcel_shape = parse_geometry_shape(parcel.geometry)
            if not parcel_shape:
                return None

            other_parcels = db.query(Parcel).filter(
                Parcel.id != parcel.id,
                Parcel.state == parcel.state
            ).all()

            for other in other_parcels:
                other_shape = parse_geometry_shape(other.geometry)
                if not other_shape:
                    continue

                if parcel_shape.overlaps(other_shape) or (parcel_shape.intersects(other_shape) and not parcel_shape.touches(other_shape)):
                    intersection = parcel_shape.intersection(other_shape)
                    overlap_area_sqm = round(intersection.area * 111320 * 111320, 2)
                    if overlap_area_sqm > 0.5:
                        return {
                            "rule": "boundary_overlap",
                            "flag": True,
                            "reason": f"Parcel boundary overlaps with neighboring parcel {other.ulpin}",
                            "evidence": {
                                "overlapping_parcel": other.ulpin,
                                "overlap_area_sqm": overlap_area_sqm
                            }
                        }
        except Exception as e:
            print("Overlap error:", e)
        return None

    @staticmethod
    def _check_protected_zone(db: Session, parcel: Parcel) -> Dict[str, Any]:
        try:
            parcel_shape = parse_geometry_shape(parcel.geometry)
            if not parcel_shape:
                return None

            zones = db.query(ProtectedZone).filter(
                ProtectedZone.state == parcel.state
            ).all()

            for zone in zones:
                zone_shape = parse_geometry_shape(zone.geometry)
                if zone_shape and zone_shape.intersects(parcel_shape):
                    return {
                        "rule": "protected_zone_containment",
                        "flag": True,
                        "reason": f"Parcel falls within protected eco-sensitive area: {zone.name}",
                        "evidence": {
                            "protected_zone": zone.name,
                            "zone_id": zone.zone_id
                        }
                    }
        except Exception as e:
            print("Zone check error:", e)
        return None

    @staticmethod
    def _check_ownership_mismatch(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        ror_owner = layers.get("ror", {}).get("owner_name")
        reg_buyer = layers.get("registration", {}).get("buyer_name")

        if ror_owner and reg_buyer:
            clean_ror = ror_owner.strip().lower()
            clean_reg = reg_buyer.strip().lower()
            if clean_ror != clean_reg:
                return {
                    "rule": "ownership_mismatch",
                    "flag": True,
                    "reason": f"Record of Rights owner ('{ror_owner}') does not match Sub-Registrar deed buyer ('{reg_buyer}')",
                    "evidence": {
                        "ror_owner": ror_owner,
                        "registration_buyer": reg_buyer
                    }
                }
        return None

    @staticmethod
    def _check_fsi_violation(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        permitted_fsi = layers.get("zoning", {}).get("permitted_fsi")
        approved_fsi = layers.get("building_permit", {}).get("approved_fsi")

        if permitted_fsi is not None and approved_fsi is not None:
            try:
                p_fsi = float(permitted_fsi)
                a_fsi = float(approved_fsi)
                if a_fsi > p_fsi:
                    return {
                        "rule": "zoning_fsi_violation",
                        "flag": True,
                        "reason": f"Approved building permit FSI ({a_fsi}) exceeds permitted zoning FSI limit ({p_fsi})",
                        "evidence": {
                            "permitted_fsi": p_fsi,
                            "approved_fsi": a_fsi
                        }
                    }
            except (ValueError, TypeError):
                pass
        return None

    @staticmethod
    def _check_encumbrance(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        encumbrance = layers.get("encumbrance", {})
        if encumbrance.get("active") is True:
            return {
                "rule": "active_encumbrance",
                "flag": True,
                "reason": "Active financial mortgage or legal encumbrance registered against parcel",
                "evidence": {
                    "source": encumbrance.get("source", "sub_registrar")
                }
            }
        return None
