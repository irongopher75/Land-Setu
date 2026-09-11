import os
import csv
import json
from sqlalchemy.orm import Session
from shapely.geometry import shape

from app.db import engine, SessionLocal, Base, IS_SQLITE
from app.models import Parcel, ProtectedZone
from app.adapter import adapter_engine

def seed_database():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()

    try:
        if db.query(Parcel).count() > 0:
            print("Database already seeded.")
            return

        print("Seeding database with Tamil Nadu and Chandigarh land records...")

        mock_files = [
            {
                "state": "TamilNadu",
                "csv": "mock_data/tamilnadu_parcels.csv",
                "geojson": "mock_data/tamilnadu_geometries.geojson"
            },
            {
                "state": "Chandigarh",
                "csv": "mock_data/chandigarh_parcels.csv",
                "geojson": "mock_data/chandigarh_geometries.geojson"
            }
        ]

        for mock in mock_files:
            state = mock["state"]
            csv_path = mock["csv"]
            geojson_path = mock["geojson"]

            if not os.path.exists(csv_path) or not os.path.exists(geojson_path):
                continue

            geometries = {}
            protected_zones = []
            with open(geojson_path, "r", encoding="utf-8") as f:
                geojson_data = json.load(f)
                for feat in geojson_data.get("features", []):
                    props = feat.get("properties", {})
                    geom = feat.get("geometry")
                    if props.get("type") == "parcel" and "ulpin" in props:
                        geometries[props["ulpin"]] = geom
                    elif props.get("type") == "protected_zone":
                        protected_zones.append({
                            "zone_id": props.get("zone_id"),
                            "name": props.get("name"),
                            "state": state,
                            "geometry": geom
                        })

            for pz in protected_zones:
                if not IS_SQLITE:
                    from geoalchemy2.shape import from_shape
                    geom_val = from_shape(shape(pz["geometry"]), srid=4326)
                else:
                    geom_val = pz["geometry"]

                zone_model = ProtectedZone(
                    zone_id=pz["zone_id"],
                    state=pz["state"],
                    name=pz["name"],
                    geometry=geom_val
                )
                db.add(zone_model)

            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    ulpin = row["ulpin"]
                    geom_json = geometries.get(ulpin)
                    if not geom_json:
                        continue

                    canonical = adapter_engine.normalize(state, row, geom_json)

                    if not IS_SQLITE:
                        from geoalchemy2.shape import from_shape
                        geom_val = from_shape(shape(geom_json), srid=4326)
                    else:
                        geom_val = geom_json

                    parcel_model = Parcel(
                        ulpin=ulpin,
                        state=state,
                        area_sqm=canonical.get("area_sqm"),
                        geometry=geom_val,
                        layers=canonical.get("layers", {}),
                        raw_record=row
                    )
                    db.add(parcel_model)

        db.commit()
        print(f"Successfully seeded DB! Parcels: {db.query(Parcel).count()}, Protected Zones: {db.query(ProtectedZone).count()}")

    except Exception as e:
        db.rollback()
        print(f"Error seeding DB: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
