"""
Spatial Registry for Indian States & Union Territories.
Provides precise GIS point-in-polygon state detection based on latitude and longitude coordinates.
"""

from shapely.geometry import Point, Polygon

INDIAN_STATES = [
    {
        "name": "TamilNadu",
        "label": "Tamil Nadu",
        "code": "TN",
        "capital": "Chennai",
        "center": [13.0827, 80.2707],
        "urban_city": {"name": "Chennai Metropolitan Corp", "district": "Chennai", "lgd_code": "TN-URB-001"},
        "rural_village": {"name": "Nemili Revenue Village", "district": "Kanchipuram", "lgd_code": "TN-RUR-042"},
        "bbox": {"min_lat": 8.0, "max_lat": 13.6, "min_lng": 76.2, "max_lng": 80.4},
        "polygon": [
            [76.2, 11.5], [76.5, 12.0], [77.3, 12.8], [78.2, 13.0], [79.5, 13.5], [80.4, 13.6],
            [80.3, 12.8], [79.9, 11.9], [79.8, 10.8], [79.4, 10.3], [79.2, 9.2], [78.0, 8.5],
            [77.5, 8.0], [77.2, 8.2], [77.0, 9.0], [76.8, 9.8], [76.4, 10.5], [76.2, 11.5]
        ]
    },
    {
        "name": "Chandigarh",
        "label": "Chandigarh",
        "code": "CHD",
        "capital": "Chandigarh",
        "center": [30.7333, 76.7794],
        "urban_city": {"name": "Sector 17 Commercial Urban Zone", "district": "Chandigarh Urban", "lgd_code": "CHD-URB-017"},
        "rural_village": {"name": "Kishangarh Revenue Village", "district": "Chandigarh Rural", "lgd_code": "CHD-RUR-002"},
        "bbox": {"min_lat": 30.65, "max_lat": 30.80, "min_lng": 76.70, "max_lng": 76.85},
        "polygon": [
            [76.70, 30.65], [76.85, 30.65], [76.85, 30.80], [76.70, 30.80], [76.70, 30.65]
        ]
    },
    {
        "name": "Maharashtra",
        "label": "Maharashtra",
        "code": "MH",
        "capital": "Mumbai",
        "center": [19.0760, 72.8777],
        "urban_city": {"name": "Pune Municipal Corp Zone", "district": "Pune Urban", "lgd_code": "MH-URB-712"},
        "rural_village": {"name": "Haveli Tehsil Gram Panchayat", "district": "Pune Rural", "lgd_code": "MH-RUR-449"},
        "bbox": {"min_lat": 15.6, "max_lat": 22.0, "min_lng": 72.6, "max_lng": 80.9},
        "polygon": [
            [72.6, 19.8], [72.8, 20.2], [72.7, 20.4], [72.9, 20.9], [73.5, 20.3], [74.5, 21.6],
            [76.0, 21.4], [78.2, 21.8], [79.5, 21.7], [80.9, 20.9], [80.3, 19.8], [80.0, 18.8],
            [79.0, 18.7], [78.0, 19.8], [77.5, 18.3], [76.5, 17.7], [75.5, 17.7], [74.0, 15.6],
            [73.6, 15.8], [73.2, 16.5], [73.0, 18.0], [72.6, 19.8]
        ]
    },
    {
        "name": "Karnataka",
        "label": "Karnataka",
        "code": "KA",
        "capital": "Bengaluru",
        "center": [12.9716, 77.5946],
        "urban_city": {"name": "BBMP Electronics City Ward", "district": "Bengaluru Urban", "lgd_code": "KA-URB-088"},
        "rural_village": {"name": "Devanahalli Revenue Village", "district": "Bengaluru Rural", "lgd_code": "KA-RUR-112"},
        "bbox": {"min_lat": 11.5, "max_lat": 18.5, "min_lng": 74.0, "max_lng": 78.6},
        "polygon": [
            [74.0, 14.8], [74.0, 15.6], [75.5, 17.7], [76.5, 17.7], [77.5, 18.3], [77.6, 17.8],
            [77.6, 16.5], [78.6, 13.8], [78.3, 12.7], [77.3, 12.8], [76.5, 12.0], [76.2, 11.5],
            [75.0, 12.0], [74.8, 13.2], [74.0, 14.8]
        ]
    },
    {
        "name": "Delhi",
        "label": "Delhi (NCT)",
        "code": "DL",
        "capital": "New Delhi",
        "center": [28.6139, 77.2090],
        "bbox": {"min_lat": 28.4, "max_lat": 28.9, "min_lng": 76.8, "max_lng": 77.4},
        "polygon": [
            [76.80, 28.40], [77.40, 28.40], [77.40, 28.90], [76.80, 28.90], [76.80, 28.40]
        ]
    },
    {
        "name": "Telangana",
        "label": "Telangana",
        "code": "TS",
        "capital": "Hyderabad",
        "center": [17.3850, 78.4867],
        "bbox": {"min_lat": 15.8, "max_lat": 19.9, "min_lng": 77.2, "max_lng": 81.8},
        "polygon": [
            [77.2, 18.3], [78.0, 19.8], [79.0, 18.7], [80.0, 18.8], [80.3, 19.8], [81.3, 17.8],
            [81.8, 17.5], [80.8, 16.8], [79.8, 16.5], [79.0, 15.8], [77.6, 15.8], [77.6, 16.5],
            [77.6, 17.8], [77.2, 18.3]
        ]
    },
    {
        "name": "Kerala",
        "label": "Kerala",
        "code": "KL",
        "capital": "Thiruvananthapuram",
        "center": [9.9312, 76.2673],
        "bbox": {"min_lat": 8.2, "max_lat": 12.8, "min_lng": 74.8, "max_lng": 77.5},
        "polygon": [
            [74.8, 12.8], [76.2, 11.5], [76.4, 10.5], [76.8, 9.8], [77.0, 9.0], [77.2, 8.2],
            [77.5, 8.0], [76.8, 8.3], [76.2, 9.5], [75.5, 11.0], [74.8, 12.8]
        ]
    },
    {
        "name": "WestBengal",
        "label": "West Bengal",
        "code": "WB",
        "capital": "Kolkata",
        "center": [22.5726, 88.3639],
        "bbox": {"min_lat": 21.5, "max_lat": 27.2, "min_lng": 85.8, "max_lng": 89.8},
        "polygon": [
            [85.8, 21.5], [87.0, 21.5], [88.2, 21.6], [89.1, 21.6], [89.8, 22.0], [88.9, 23.8],
            [88.3, 26.5], [88.9, 27.2], [88.0, 27.2], [87.8, 26.5], [87.0, 24.5], [86.8, 22.8],
            [85.8, 22.3], [85.8, 21.5]
        ]
    },
    {
        "name": "Gujarat",
        "label": "Gujarat",
        "code": "GJ",
        "capital": "Gandhinagar",
        "center": [23.0225, 72.5714],
        "bbox": {"min_lat": 20.1, "max_lat": 24.7, "min_lng": 68.1, "max_lng": 74.5},
        "polygon": [
            [68.1, 23.7], [70.5, 24.7], [72.5, 24.7], [74.5, 23.5], [74.0, 22.0], [73.5, 20.3],
            [72.9, 20.9], [72.7, 20.4], [72.6, 21.5], [70.0, 20.8], [68.9, 22.4], [68.1, 23.7]
        ]
    },
    {
        "name": "Rajasthan",
        "label": "Rajasthan",
        "code": "RJ",
        "capital": "Jaipur",
        "center": [26.9124, 75.7873],
        "bbox": {"min_lat": 23.0, "max_lat": 30.2, "min_lng": 69.5, "max_lng": 78.2},
        "polygon": [
            [69.5, 26.8], [71.0, 28.5], [73.8, 29.8], [75.5, 30.2], [77.2, 27.8], [78.2, 26.8],
            [77.5, 24.5], [74.5, 23.5], [72.5, 24.7], [70.5, 24.7], [69.5, 26.8]
        ]
    },
    {
        "name": "UttarPradesh",
        "label": "Uttar Pradesh",
        "code": "UP",
        "capital": "Lucknow",
        "center": [26.8467, 80.9462],
        "bbox": {"min_lat": 23.8, "max_lat": 30.4, "min_lng": 77.1, "max_lng": 84.6},
        "polygon": [
            [77.1, 28.8], [77.5, 30.4], [78.5, 29.5], [80.5, 28.5], [84.6, 27.5], [84.6, 26.0],
            [83.0, 23.8], [81.5, 24.5], [79.5, 24.2], [78.2, 26.8], [77.2, 27.8], [77.1, 28.8]
        ]
    },
    {
        "name": "Punjab",
        "label": "Punjab",
        "code": "PB",
        "capital": "Chandigarh",
        "center": [30.9010, 75.8573],
        "bbox": {"min_lat": 29.5, "max_lat": 32.5, "min_lng": 73.8, "max_lng": 76.9},
        "polygon": [
            [73.8, 29.5], [74.5, 31.5], [75.8, 32.5], [76.9, 31.5], [76.7, 30.7], [76.5, 29.5],
            [75.0, 29.5], [73.8, 29.5]
        ]
    },
    {
        "name": "MadhyaPradesh",
        "label": "Madhya Pradesh",
        "code": "MP",
        "capital": "Bhopal",
        "center": [23.2599, 77.4126],
        "bbox": {"min_lat": 21.1, "max_lat": 26.9, "min_lng": 74.0, "max_lng": 82.8},
        "polygon": [
            [74.0, 21.1], [74.5, 23.5], [77.5, 24.5], [79.5, 24.2], [81.5, 24.5], [82.8, 24.0],
            [82.0, 21.8], [80.9, 20.9], [79.5, 21.7], [78.2, 21.8], [76.0, 21.4], [74.5, 21.6],
            [74.0, 21.1]
        ]
    }
]

# Pre-instantiate Shapely Polygon objects for performance
_PREPARED_POLYGONS = [
    (state, Polygon(state["polygon"])) for state in INDIAN_STATES
]

def detect_state_from_coords(lat: float, lng: float) -> dict:
    """
    Uniquely identifies the Indian State based on pointer latitude and longitude
    using Shapely Point-in-Polygon geometric intersection.
    """
    pt = Point(lng, lat)

    # 1. Exact Point-in-Polygon GIS check
    for state, poly in _PREPARED_POLYGONS:
        if poly.contains(pt) or poly.touches(pt):
            return state

    # 2. Minimum distance to state polygon boundary fallback (for points near coastlines/borders)
    closest = None
    min_dist = float('inf')
    for state, poly in _PREPARED_POLYGONS:
        dist = poly.distance(pt)
        if dist < min_dist:
            min_dist = dist
            closest = state

    return closest or INDIAN_STATES[0]

