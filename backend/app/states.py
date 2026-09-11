"""
Spatial Registry for Indian States & Union Territories.
Provides automatic spatial point-in-bbox detection based on latitude and longitude coordinates.
"""

INDIAN_STATES = [
    {
        "name": "TamilNadu",
        "label": "Tamil Nadu",
        "code": "TN",
        "capital": "Chennai",
        "center": [13.0827, 80.2707],
        "bbox": {"min_lat": 8.0, "max_lat": 13.6, "min_lng": 76.2, "max_lng": 80.4}
    },
    {
        "name": "Chandigarh",
        "label": "Chandigarh",
        "code": "CHD",
        "capital": "Chandigarh",
        "center": [30.7333, 76.7794],
        "bbox": {"min_lat": 30.65, "max_lat": 30.80, "min_lng": 76.70, "max_lng": 76.85}
    },
    {
        "name": "Maharashtra",
        "label": "Maharashtra",
        "code": "MH",
        "capital": "Mumbai",
        "center": [19.0760, 72.8777],
        "bbox": {"min_lat": 15.6, "max_lat": 22.0, "min_lng": 72.6, "max_lng": 80.9}
    },
    {
        "name": "Karnataka",
        "label": "Karnataka",
        "code": "KA",
        "capital": "Bengaluru",
        "center": [12.9716, 77.5946],
        "bbox": {"min_lat": 11.5, "max_lat": 18.5, "min_lng": 74.0, "max_lng": 78.6}
    },
    {
        "name": "Delhi",
        "label": "Delhi (NCT)",
        "code": "DL",
        "capital": "New Delhi",
        "center": [28.6139, 77.2090],
        "bbox": {"min_lat": 28.4, "max_lat": 28.9, "min_lng": 76.8, "max_lng": 77.4}
    },
    {
        "name": "Telangana",
        "label": "Telangana",
        "code": "TS",
        "capital": "Hyderabad",
        "center": [17.3850, 78.4867],
        "bbox": {"min_lat": 15.8, "max_lat": 19.9, "min_lng": 77.2, "max_lng": 81.8}
    },
    {
        "name": "Kerala",
        "label": "Kerala",
        "code": "KL",
        "capital": "Thiruvananthapuram",
        "center": [9.9312, 76.2673],
        "bbox": {"min_lat": 8.2, "max_lat": 12.8, "min_lng": 74.8, "max_lng": 77.5}
    },
    {
        "name": "WestBengal",
        "label": "West Bengal",
        "code": "WB",
        "capital": "Kolkata",
        "center": [22.5726, 88.3639],
        "bbox": {"min_lat": 21.5, "max_lat": 27.2, "min_lng": 85.8, "max_lng": 89.8}
    },
    {
        "name": "Gujarat",
        "label": "Gujarat",
        "code": "GJ",
        "capital": "Gandhinagar",
        "center": [23.0225, 72.5714],
        "bbox": {"min_lat": 20.1, "max_lat": 24.7, "min_lng": 68.1, "max_lng": 74.5}
    },
    {
        "name": "Rajasthan",
        "label": "Rajasthan",
        "code": "RJ",
        "capital": "Jaipur",
        "center": [26.9124, 75.7873],
        "bbox": {"min_lat": 23.0, "max_lat": 30.2, "min_lng": 69.5, "max_lng": 78.2}
    },
    {
        "name": "UttarPradesh",
        "label": "Uttar Pradesh",
        "code": "UP",
        "capital": "Lucknow",
        "center": [26.8467, 80.9462],
        "bbox": {"min_lat": 23.8, "max_lat": 30.4, "min_lng": 77.1, "max_lng": 84.6}
    },
    {
        "name": "Punjab",
        "label": "Punjab",
        "code": "PB",
        "capital": "Chandigarh",
        "center": [30.9010, 75.8573],
        "bbox": {"min_lat": 29.5, "max_lat": 32.5, "min_lng": 73.8, "max_lng": 76.9}
    },
    {
        "name": "MadhyaPradesh",
        "label": "Madhya Pradesh",
        "code": "MP",
        "capital": "Bhopal",
        "center": [23.2599, 77.4126],
        "bbox": {"min_lat": 21.1, "max_lat": 26.9, "min_lng": 74.0, "max_lng": 82.8}
    }
]

def detect_state_from_coords(lat: float, lng: float) -> dict:
    """
    Uniquely identifies the Indian State based on pointer latitude and longitude.
    """
    for state in INDIAN_STATES:
        bbox = state["bbox"]
        if bbox["min_lat"] <= lat <= bbox["max_lat"] and bbox["min_lng"] <= lng <= bbox["max_lng"]:
            return state

    # Calculate closest state by distance if outside exact bboxes
    closest = None
    min_dist = float('inf')
    for state in INDIAN_STATES:
        c_lat, c_lng = state["center"]
        dist = (lat - c_lat) ** 2 + (lng - c_lng) ** 2
        if dist < min_dist:
            min_dist = dist
            closest = state

    return closest or INDIAN_STATES[0]
