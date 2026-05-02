import os
import urllib.request
import ssl
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

SEMESTERS = {
    "H-2026": "20261",
    "E-2026": "20262",
    "A-2026": "20263",
}

BASE_URL = "https://horaire.etsmtl.ca/HorairePublication/HorairePublication_{sem}_{prog}.pdf"

def download_pdfs():
    os.makedirs("pdfs", exist_ok=True)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    for sem_label, sem_id in SEMESTERS.items():
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
                print(f"    [FAIL] Failed: {e}")

def parse_all():
    os.makedirs("data", exist_ok=True)
    for sem_label in SEMESTERS:
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

if __name__ == "__main__":
    print("=== Downloading PDFs ===")
    download_pdfs()
    print("\n=== Parsing PDFs to CSV ===")
    parse_all()
    print("\nDone!")
