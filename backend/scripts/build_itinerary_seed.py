"""Build the canonical Sicily.pdf seed without adding information absent from the PDF."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path


def activity(title: str, location: str, kind: str = "city", notes: str | None = None) -> dict:
    return {"title": title, "location": location, "start_time": None, "end_time": None,
            "activity_type": kind, "status": "planned", "notes": notes, "coordinates": None, "sort_order": 0}


def route(origin: str, destination: str) -> dict:
    return {"origin": origin, "destination": destination, "origin_coordinates": None,
            "destination_coordinates": None, "planned_departure": None,
            "planned_duration_minutes": None, "distance_km": None}


records = {
    1: dict(title="Catania", base="Catania", destinations=["Catania"], kind="city",
        activities=[activity("Visita di Catania", "Catania")], poi=["Via Crociferi (via delle chiese)","Pescheria (mercato)","Piazza del Duomo","Fontana dell'Elefante","Via Etnea","Piazza Università","Teatro Massimo Bellini","Giardino Bellini - Villa Bellini"]),
    2: dict(title="Taormina e mare", base="Taormina", destinations=["Taormina","Isola Bella"], kind="sea", notes="+ mare",
        activities=[activity("Visita di Taormina","Taormina"),activity("Mare a Isola Bella","Isola Bella, Taormina","sea")], poi=["Duomo di Taormina","Corso Umberto","Palazzo Corvaja","Villa Comunale","Teatro Antico","Isola Bella"]),
    3: dict(title="Etna → Siracusa", base="Etna", destinations=["Etna","Siracusa"], kind="etna", overnight="Siracusa", notes="Escursione Etna, poi trasferimento a Siracusa.",
        activities=[activity("Escursione Etna","Etna","etna"),activity("Trasferimento a Siracusa","Siracusa","transfer")], poi=[], routes=[route("Etna","Siracusa")]),
    4: dict(title="Siracusa e Ortigia", base="Siracusa", destinations=["Siracusa","Ortigia"], kind="archaeology",
        activities=[activity("Visita di Ortigia","Ortigia, Siracusa"),activity("Parco Archeologico Neapolis","Siracusa","archaeology")], poi=["Isola di Ortigia","Lungomare Alfeo","Fonte Aretusa","Fontana di Diana","Piazza Duomo","Cattedrale di Siracusa","Tempio di Apollo","Parco Archeologico Neapolis","Orecchio di Dionisio","Teatro greco","Santuario Madonna delle Lacrime"]),
    5: dict(title="Pillirina, Noto e Marzamemi", base="Siracusa", destinations=["Pillirina","Noto","Marzamemi"], kind="boat_trip", notes="Marzamemi al tramonto.",
        activities=[activity("Pillirina boat tour","Pillirina","boat_trip"),activity("Visita di Noto","Noto"),activity("Marzamemi al tramonto","Marzamemi","sea","Tramonto")], poi=["Pillirina","Teatro Comunale Tina di Lorenzo","Chiesa di San Domenico","Via Corrado Nicolaci","Cattedrale di Noto","Palazzo Ducezio","Chiesa dell’Immacolata","Porta Reale","Vicolo delle sirene","Piazza Regina Margherita","Tonnara di Marzamemi"], routes=[route("Pillirina","Noto"),route("Noto","Marzamemi")]),
    6: dict(title="Ragusa, Modica e Scicli → Agrigento", base="Ragusa", destinations=["Ragusa","Ragusa Ibla","Modica","Scicli","Agrigento","Valle dei Templi"], kind="road_trip", overnight="Agrigento", notes="Dopo Scicli trasferimento ad Agrigento; Valle dei Templi indicata nel PDF dopo il trasferimento.",
        activities=[activity("Ragusa e Ibla","Ragusa"),activity("Visita di Modica","Modica"),activity("Visita di Scicli","Scicli"),activity("Trasferimento ad Agrigento","Agrigento","transfer"),activity("Valle dei Templi","Agrigento","archaeology")], poi=["Cattedrale di San Giovanni Battista","Corso Italia con vicoli/chiese/palazzi","Chiesa di Santa Maria delle Scale","Via delle Scale","Chiesa di Santa Maria dell’Itria","Ragusa Ibla","Palazzo della Cancelleria","Piazza Duomo Ragusa Ibla","Duomo di San Giorgio Ragusa","Circolo di Conversazione","Corso XXV aprile","Giardino Ibleo","Duomo di San Giorgio Modica","Belvedere di San Benedetto","Corso Umberto I Modica","Duomo di San Pietro","Piazza Busacca","Via Penna","Chiesa di San Michele Arcangelo","Antica Farmacia Cartia","Chiesa di San Giovanni Evangelista (Cristo in gonnella)","Palazzo Beneventano","Piazza Italia","Chiesa di San Ignazio di Loyola","Chiesa di San Bartolomeo","Valle dei Templi"], routes=[route("Ragusa","Modica"),route("Modica","Scicli"),route("Scicli","Agrigento")]),
    7: dict(title="Agrigento e Scala dei Turchi", base="Agrigento", destinations=["Agrigento","Scala dei Turchi"], kind="city",
        activities=[activity("Visita di Agrigento","Agrigento"),activity("Scala dei Turchi","Scala dei Turchi","sea")], poi=["Statua Andrea Camilleri","Basilica della Beata Vergine Maria","Via Atenea","Scala degli artisti","Camera di Commercio","Piazza del Municipio","Teatro Pirandello","Cattedrale di San Gerlando","Scala dei Turchi"], routes=[route("Agrigento","Scala dei Turchi")]),
    8: dict(title="Gibellina e Trapani", base="Agrigento", destinations=["Gibellina","Cretto di Burri","Trapani"], kind="road_trip", overnight="Trapani",
        activities=[activity("Gibellina e Cretto di Burri","Gibellina"),activity("Trapani","Trapani","transfer")], poi=["Gibellina","Cretto di Burri","Trapani"], routes=[route("Agrigento","Gibellina"),route("Gibellina","Trapani")]),
    9: dict(title=None, base="Trapani", destinations=[], kind="free_time", notes="Nessuna attività assegnata nel PDF.", activities=[], poi=[]),
    10: dict(title="Boat tour Favignana", base="Trapani", destinations=["Favignana"], kind="boat_trip", activities=[activity("Boat tour Favignana","Favignana","boat_trip")], poi=["Favignana"]),
    11: dict(title="San Vito Lo Capo", base="Trapani", destinations=["San Vito Lo Capo"], kind="sea", activities=[activity("San Vito Lo Capo","San Vito Lo Capo","sea")], poi=["San Vito Lo Capo"], routes=[route("Trapani","San Vito Lo Capo")]),
    12: dict(title=None, base="Trapani", destinations=[], kind="free_time", notes="Nessuna attività assegnata nel PDF.", activities=[], poi=[]),
    13: dict(title="Riserva dello Zingaro", base="Trapani", destinations=["Riserva dello Zingaro"], kind="hiking", activities=[activity("Riserva dello Zingaro","Riserva dello Zingaro","hiking")], poi=["Riserva dello Zingaro"], routes=[route("Trapani","Riserva dello Zingaro")]),
    14: dict(title=None, base=None, destinations=[], kind="free_time", notes="Nessuna attività assegnata nel PDF.", activities=[], poi=[]),
    15: dict(title=None, base=None, destinations=[], kind="free_time", notes="Nessuna attività assegnata nel PDF. Lista separata non datata: Trapani / Erice; Monreale / Palermo; Cefalù. Note: Trapani - gelati e granite; Erice - gelati e granite.", activities=[], poi=[]),
}

start = date(2026, 8, 21)
days = []
for number in range(1, 16):
    item = records[number]
    for index, entry in enumerate(item["activities"]):
        entry["sort_order"] = index
    days.append({"date": (start + timedelta(days=number - 1)).isoformat(), "dayNumber": number,
        "title": item["title"], "baseCity": item["base"], "destinations": item["destinations"],
        "activityType": item["kind"], "activities": item["activities"], "pointsOfInterest": item["poi"],
        "routes": item.get("routes", []), "notes": item.get("notes"), "overnightLocation": item.get("overnight"),
        "coordinates": None, "status": "planned"})

payload = {"source":"Sicily.pdf", "sourceImportedAt":"2026-08-17", "tripStartDate":"2026-08-21",
    "tripEndDate":"2026-09-04", "unscheduledNotes":["Trapani / Erice","Monreale / Palermo","Cefalù","Trapani - gelati e granite","Erice - gelati e granite"], "days":days}
Path(__file__).parents[1].joinpath("data", "itinerary.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
