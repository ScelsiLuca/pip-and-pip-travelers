from datetime import date, datetime
from zoneinfo import ZoneInfo
from app.services import leave_now, prioritize_alerts, trip_context, trip_day_number


def test_day_number():
    assert trip_day_number(date(2026,8,21)) == 1
    assert trip_day_number(date(2026,9,4)) == 15
    assert trip_day_number(date(2026,9,5)) is None


def test_today_tomorrow_rome():
    ctx = trip_context(datetime(2026,8,23,23,30,tzinfo=ZoneInfo("Europe/Rome")))
    assert ctx["dayNumber"] == 3 and ctx["tomorrow"] == "2026-08-24"


def test_leave_now_without_traffic():
    tz = ZoneInfo("Europe/Rome")
    result = leave_now(datetime(2026,8,23,10,30,tzinfo=tz), 40, None, 20, datetime(2026,8,23,9,0,tzinfo=tz))
    assert result["departureSuggested"].endswith("09:30:00+02:00")
    assert result["trafficAvailable"] is False


def test_contextual_alert_priority():
    items = [{"location":"Siracusa","level":"critical"},{"location":"Etna","level":"warning"}]
    assert prioritize_alerts(items, ["Etna","Siracusa"])[0]["location"] == "Etna"

