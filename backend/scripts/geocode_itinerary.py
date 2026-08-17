"""One-time, rate-limited Nominatim enrichment. Results are persisted in the seed."""
from __future__ import annotations
import argparse, asyncio, json, re, sqlite3, unicodedata
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
import httpx

SEED=Path(__file__).parents[1]/"data"/"itinerary.json"
CACHE=Path(__file__).parents[1]/"data"/"geocoding.json"
DATABASE=Path(__file__).parents[2]/"data"/"sicily.sqlite3"
REPORT=Path(__file__).parents[1]/"data"/"geocoding_report.json"
HEADERS={"User-Agent":"PipAndPipTravelers/1.0 (personal itinerary POI geocoding; contact: local-user)"}

def normalized(value:str)->str:
    plain="".join(c for c in unicodedata.normalize("NFKD",value) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+"," ",plain.casefold()).strip()

def distance_km(a:dict,b:dict)->float:
    lat1,lon1,lat2,lon2=map(radians,[float(a["lat"]),float(a["lon"]),float(b["lat"]),float(b["lon"])])
    dlat=lat2-lat1;dlon=lon2-lon1
    return 6371*2*asin(sqrt(sin(dlat/2)**2+cos(lat1)*cos(lat2)*sin(dlon/2)**2))

def choose(values:list[dict],name:str,context:str|None)->tuple[dict|None,str]:
    sicily=[x for x in values if "sicilia" in normalized(x.get("display_name",""))]
    candidates=sicily or values
    if not candidates:return None,"unresolved"
    top=candidates[0]; display=normalized(top.get("display_name","")); name_words=[w for w in normalized(name).split() if len(w)>2 and w not in {"della","delle","degli","chiesa","piazza","via"}]
    context_ok=not context or normalized(context) in display
    name_ok=not name_words or sum(w in display for w in name_words)>=max(1,len(name_words)-1)
    if not context_ok or not name_ok:return None,"ambiguous"
    if len(candidates)>1:
        second=candidates[1]; importance_gap=float(top.get("importance",0))-float(second.get("importance",0))
        if distance_km(top,second)>1 and importance_gap<0.08:return None,"ambiguous"
    return top,"resolved"

async def resolve(client:httpx.AsyncClient,cache:dict,name:str,context:str|None=None):
    query=f"{name}, {context}, Sicilia, Italia" if context and context.casefold() not in name.casefold() else f"{name}, Sicilia, Italia"
    if query in cache:
        item=cache[query]
        return item.get("coordinates") if isinstance(item,dict) and item.get("status")=="resolved" else None
    response=await client.get("https://nominatim.openstreetmap.org/search",params={"q":query,"format":"jsonv2","limit":3,"countrycodes":"it","addressdetails":1})
    response.raise_for_status(); values=response.json();picked,status=choose(values,name,context)
    coordinates=None if not picked else {"lat":float(picked["lat"]),"lon":float(picked["lon"]),"displayName":picked["display_name"],"source":"OpenStreetMap Nominatim"}
    cache[query]={"status":status,"coordinates":coordinates,"candidates":[x.get("display_name") for x in values[:3]]}
    CACHE.write_text(json.dumps(cache,ensure_ascii=False,indent=2),encoding="utf-8")
    await asyncio.sleep(1.1)
    return coordinates

async def main():
    parser=argparse.ArgumentParser();parser.add_argument("--day",type=int);args=parser.parse_args()
    data=json.loads(SEED.read_text(encoding="utf-8")); cache=json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    async with httpx.AsyncClient(timeout=15,headers=HEADERS) as client:
        for day in data["days"]:
            if args.day and day["dayNumber"]!=args.day:continue
            context=day["baseCity"] or (day["destinations"][0] if day["destinations"] else None)
            if context and not day.get("coordinates"): day["coordinates"]=await resolve(client,cache,context)
            for item in day["activities"]:
                if item.get("location") and not item.get("coordinates"): item["coordinates"]=await resolve(client,cache,item["location"],context)
            points=[]
            for raw in day["pointsOfInterest"]:
                item=raw if isinstance(raw,dict) else {"name":raw,"category":"poi","coordinates":None}
                if not item.get("coordinates"): item["coordinates"]=await resolve(client,cache,item["name"],context)
                points.append(item)
            day["pointsOfInterest"]=points
            for item in day["routes"]:
                if not item.get("origin_coordinates"): item["origin_coordinates"]=await resolve(client,cache,item["origin"])
                if not item.get("destination_coordinates"): item["destination_coordinates"]=await resolve(client,cache,item["destination"])
    SEED.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    if DATABASE.exists():
        with sqlite3.connect(DATABASE) as db:
            for day in data["days"]:
                db.execute("UPDATE trip_days SET points_of_interest=?, coordinates=? WHERE date=?",
                    (json.dumps(day["pointsOfInterest"],ensure_ascii=False),json.dumps(day["coordinates"],ensure_ascii=False),day["date"]))
            db.commit()
    poi_resolved=sum(1 for d in data["days"] for p in d["pointsOfInterest"] if isinstance(p,dict) and p.get("coordinates"))
    poi_missing=[{"day":d["dayNumber"],"name":p["name"]} for d in data["days"] for p in d["pointsOfInterest"] if isinstance(p,dict) and not p.get("coordinates")]
    review=[{"query":q,**v} for q,v in cache.items() if isinstance(v,dict) and v.get("status")!="resolved"]
    report={"scope":args.day or "all","queries":len(cache),"poiResolvedTotal":poi_resolved,"poiMissing":poi_missing,"manualReview":review}
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))

if __name__=="__main__": asyncio.run(main())
