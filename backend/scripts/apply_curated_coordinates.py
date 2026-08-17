"""Apply reviewed public coordinates for unambiguous itinerary locations only."""
from __future__ import annotations
import json
from pathlib import Path

SEED=Path(__file__).parents[1]/"data"/"itinerary.json"
COORDS={
    "catania":(37.5079,15.0830),"taormina":(37.8516,15.2853),"isola bella":(37.8500,15.3016),
    "isola bella, taormina":(37.8500,15.3016),"etna":(37.7510,14.9934),"siracusa":(37.0755,15.2866),
    "ortigia":(37.0608,15.2934),"ortigia, siracusa":(37.0608,15.2934),"pillirina":(37.0003,15.3305),
    "noto":(36.8918,15.0707),"marzamemi":(36.7422,15.1174),"ragusa":(36.9269,14.7255),
    "ragusa ibla":(36.9250,14.7413),"modica":(36.8588,14.7608),"scicli":(36.7901,14.7040),
    "agrigento":(37.3111,13.5765),"valle dei templi":(37.2907,13.5852),
    "scala dei turchi":(37.2890,13.4722),"gibellina":(37.8087,12.8704),
    "cretto di burri":(37.7206,12.8906),"trapani":(38.0176,12.5365),"favignana":(37.9307,12.3291),
    "san vito lo capo":(38.1755,12.7356),"riserva dello zingaro":(38.1240,12.7890),
}
def lookup(name):
    pair=COORDS.get(name.casefold().strip())
    return None if not pair else {"lat":pair[0],"lon":pair[1],"source":"reviewed local catalog"}
data=json.loads(SEED.read_text(encoding="utf-8"))
for day in data["days"]:
    day["coordinates"]=lookup(day["baseCity"]) if day["baseCity"] else None
    for item in day["activities"]: item["coordinates"]=lookup(item["location"])
    day["pointsOfInterest"]=[{"name":x if isinstance(x,str) else x["name"],"category":"poi","coordinates":lookup(x if isinstance(x,str) else x["name"])} for x in day["pointsOfInterest"]]
    for item in day["routes"]:
        item["origin_coordinates"]=lookup(item["origin"]);item["destination_coordinates"]=lookup(item["destination"])
SEED.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
