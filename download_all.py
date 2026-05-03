import os
import json
import urllib.request
import ssl
from datetime import datetime
from horaire import extract_course_info

PROGRAMS = {
    "gti": {"name": "Génie des technologies de l'information", "id": "7086"},
    "ctn": {"name": "Génie de la construction", "id": "7625"},
    "log": {"name": "Génie logiciel", "id": "7084"},
    "gol": {"name": "Génie des opérations et de la logistique", "id": "6556"},
    "aer": {"name": "Génie aérospatial", "id": "6522"},
    "ux":  {"name": "Design UX", "id": "6599"},
    "ele": {"name": "Génie électrique", "id": "7694"},
    "mec": {"name": "Génie mécanique", "id": "7684"},
    "gpa": {"name": "Génie de la production automatisée", "id": "6557"},
    "inf": {"name": "Informatique distribuée", "id": "6646"},
}

SEASON_CODES = {"H": "1", "E": "2", "A": "3"}
SEASON_NAMES = {"H": "Hiver", "E": "Été", "A": "Automne"}

BASE_URL = "https://horaire.etsmtl.ca/HorairePublication/HorairePublication_{sem}_{prog}.pdf"

def generate_semester_candidates():
    """Generate semester codes to probe based on current date.
    Checks current year -1 through current year +1, all 3 seasons."""
    now = datetime.now()
    year = now.year
    candidates = {}
    for y in range(year - 1, year + 2):
        for season, code in SEASON_CODES.items():
            label = f"{season}-{y}"
            sem_id = f"{y}{code}"
            candidates[label] = sem_id
    return candidates

def probe_semester(sem_id, prog_id, ctx):
    """Check if a PDF exists on the ETS server via HEAD request."""
    url = BASE_URL.format(sem=sem_id, prog=prog_id)
    req = urllib.request.Request(url, method='HEAD')
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=10)
        return resp.status == 200
    except Exception:
        return False

def discover_semesters(ctx):
    """Discover which semesters are currently available on the ETS server.
    Probes using the 'log' program (7084) as a reference."""
    candidates = generate_semester_candidates()
    available = {}
    ref_prog = PROGRAMS["log"]["id"]
    
    print("Probing ETS server for available semesters...")
    for label, sem_id in sorted(candidates.items()):
        exists = probe_semester(sem_id, ref_prog, ctx)
        status = "✓ Available" if exists else "✗ Not found"
        print(f"  {label} ({sem_id}): {status}")
        if exists:
            available[label] = sem_id
    
    print(f"\nFound {len(available)} available semester(s): {', '.join(sorted(available.keys()))}")
    return available

def download_pdfs(semesters, ctx):
    os.makedirs("pdfs", exist_ok=True)
    for sem_label, sem_id in semesters.items():
        for prog_key, prog_info in PROGRAMS.items():
            url = BASE_URL.format(sem=sem_id, prog=prog_info["id"])
            filename = f"pdfs/{sem_label}_{prog_key}.pdf"
            if os.path.exists(filename):
                print(f"  [OK] Already exists: {filename}")
                continue
            print(f"  Downloading {sem_label} {prog_info['name']}...")
            try:
                urllib.request.urlretrieve(url, filename)
                print(f"    [OK] Saved to {filename}")
            except Exception as e:
                print(f"    [FAIL] {e}")

def parse_all(semesters):
    os.makedirs("data", exist_ok=True)
    for sem_label in semesters:
        for prog_key, prog_info in PROGRAMS.items():
            pdf_path = f"pdfs/{sem_label}_{prog_key}.pdf"
            csv_path = f"data/{sem_label}_{prog_key}.csv"
            if os.path.exists(csv_path):
                print(f"  [OK] Already parsed: {csv_path}")
                continue
            if not os.path.exists(pdf_path):
                print(f"  [FAIL] PDF missing: {pdf_path}")
                continue
            print(f"  Parsing {sem_label} {prog_info['name']}...")
            try:
                df = extract_course_info(pdf_path)
                if not df.empty:
                    df.to_csv(csv_path, index=False, encoding='utf-8-sig')
                    print(f"    [OK] {len(df)} entries -> {csv_path}")
                else:
                    print(f"    [FAIL] No data extracted")
            except Exception as e:
                print(f"    [FAIL] Error: {e}")

def generate_manifest(semesters):
    """Generate data/manifest.json listing all available semester+program CSVs."""
    manifest = {
        "generated": datetime.now().isoformat(),
        "semesters": [],
        "programs": []
    }
    
    # Build semester list
    for label, sem_id in sorted(semesters.items()):
        season = label.split("-")[0]
        year = label.split("-")[1]
        manifest["semesters"].append({
            "id": label,
            "code": sem_id,
            "name": f"{SEASON_NAMES[season]} {year}",
            "season": season,
            "year": int(year)
        })
    
    # Build program list
    for key, info in sorted(PROGRAMS.items()):
        manifest["programs"].append({
            "id": key,
            "name": info["name"],
            "etsId": info["id"]
        })
    
    # Check which CSV files actually exist
    manifest["available"] = []
    for label in sorted(semesters.keys()):
        for prog_key in sorted(PROGRAMS.keys()):
            csv_path = f"data/{label}_{prog_key}.csv"
            if os.path.exists(csv_path):
                size = os.path.getsize(csv_path)
                manifest["available"].append({
                    "semester": label,
                    "program": prog_key,
                    "file": f"{label}_{prog_key}.csv",
                    "size": size
                })
    
    manifest_path = "data/manifest.json"
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Manifest generated: {manifest_path}")
    print(f"  {len(manifest['semesters'])} semesters, {len(manifest['programs'])} programs, {len(manifest['available'])} CSV files")

if __name__ == "__main__":
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    print("=== Discovering Available Semesters ===")
    semesters = discover_semesters(ctx)
    
    if not semesters:
        print("\n⚠ No semesters found! Check your internet connection.")
    else:
        print(f"\n=== Downloading PDFs ({len(semesters)} semesters × {len(PROGRAMS)} programs) ===")
        download_pdfs(semesters, ctx)
        
        print("\n=== Parsing PDFs to CSV ===")
        parse_all(semesters)
    
    print("\n=== Generating Manifest ===")
    generate_manifest(semesters)
    
    print("\nDone!")
