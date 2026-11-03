"""Generate realistic fake data to exercise the agents end to end.

Phone numbers use the 555-01XX block, which is reserved for fiction, so nothing
here can ever reach a real person.

    python data/generate_sample.py           # writes data/sample/*.csv
"""

from __future__ import annotations

import csv
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "William", "Elizabeth",
         "Carlos", "Aisha", "Kevin", "Nancy", "Brian", "Sandra", "Tyrone", "Mei", "Jose", "Karen"]
LAST = ["Smith", "Johnson", "Garcia", "Brown", "Davis", "Martinez", "Lopez", "Wilson", "Anderson", "Thomas",
        "Moore", "Jackson", "Lee", "Harris", "Clark", "Lewis", "Walker", "Hall", "Young", "King"]
JOBS = [("AC replacement", 6500, 12000), ("Furnace replacement", 4500, 9000), ("Heat pump install", 8000, 16000),
        ("Ductless mini split", 3500, 9000), ("AC repair - compressor", 1200, 3500), ("Furnace repair", 300, 1500),
        ("Duct cleaning", 400, 900), ("Maintenance plan", 150, 400), ("Thermostat upgrade", 250, 700),
        ("Water heater replacement", 1500, 4000)]
CITIES = ["Columbus", "Dayton", "Akron", "Toledo", "Canton", "Westerville", "Dublin", "Hilliard"]
AREA_CODES = ["614", "937", "330", "419", "234", "380", "220", "740"]


def fake_phone(rng: random.Random, i: int) -> str:
    # unique for the first 800 indices: area code changes every 100 numbers
    return f"({AREA_CODES[(i // 100) % len(AREA_CODES)]}) 555-01{i % 100:02d}"


def estimates(rng: random.Random, n: int, today: date) -> list[dict]:
    rows = []
    for i in range(n):
        job, lo, hi = rng.choice(JOBS)
        status = rng.choices(["open", "expired", "won", "lost to competitor", "declined"], [55, 18, 15, 5, 7])[0]
        phone = fake_phone(rng, i)
        if rng.random() < 0.04:
            phone = "n/a"
        rows.append({
            "estimate_id": f"E{i + 1:04d}",
            "customer_name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
            "phone": phone,
            "job_type": job,
            "amount": round(rng.uniform(lo, hi), -1),
            "estimate_date": (today - timedelta(days=rng.randint(5, 1100))).isoformat(),
            "status": status,
            "sms_consent": rng.choice(["yes", "no", "no"]),
        })
    rows += [dict(rows[3], estimate_id="E9998"), dict(rows[7], estimate_id="E9999")]  # duplicate customers
    return rows


def contractor_leads(rng: random.Random, n: int) -> list[dict]:
    kinds = ["Heating & Cooling", "HVAC", "Air Conditioning", "Plumbing & Heating", "Comfort Systems", "Mechanical"]
    names = ["Buckeye", "Patriot", "Summit", "Reliable", "Precision", "Hometown", "Allied", "Blue Flame", "Arctic",
             "Comfort Pro", "Elite", "Family", "Valley", "Northside", "Quality", "Express"]
    rows = []
    for i in range(n):
        has_site = rng.random() < 0.45
        rows.append({
            "place_id": f"L{i + 1:04d}",
            "business_name": f"{rng.choice(names)} {rng.choice(kinds)}",
            "phone": fake_phone(rng, i + 37),
            "city": rng.choice(CITIES),
            "rating": round(rng.uniform(3.3, 5.0), 1),
            "reviews": int(rng.lognormvariate(3.3, 1.1)),
            "website": f"https://example.com/{i}" if has_site else "",
            "category": "HVAC contractor",
        })
    return rows


def write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main(out_dir: Path = ROOT / "sample", seed: int = 7, today: date = date(2026, 10, 17)) -> None:
    rng = random.Random(seed)
    write(out_dir / "estimates.csv", estimates(rng, 300, today))
    write(out_dir / "hvac_leads.csv", contractor_leads(rng, 150))
    print(f"wrote {out_dir}/estimates.csv and {out_dir}/hvac_leads.csv")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "sample")
