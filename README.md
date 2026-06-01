# ÉTS Schedule Generator

A tool to automatically download, parse, and generate optimal course schedules for ÉTS (École de technologie supérieure) students.

## Features
- **Automated Data Fetching**: Daily GitHub Action checks and downloads the latest PDF schedules for all engineering programs.
- **Schedule Generation**: Extract sections, classes, and lab hours to find combination of schedules that work without conflicts.
- **Web Interface**: Interactive UI to view and explore all valid schedules.

## Structure
- index.html / iewer.html: Web interface for exploring and viewing schedules.
- pp.js / styles.css: Frontend interaction and styling.
- download_all.py: Script to fetch all the latest program schedules from the ÉTS website.
- horaire.py / schedule_generator.py: Parsing PDFs to structural data and generating valid conflict-free combinations.
- data/: CSV and JSON outputs containing aggregated schedule availability.

## Setup

Make sure you have Python 3.12+ installed.

`ash
pip install pdfplumber pandas
python download_all.py
``n
## GitHub Actions

This repository includes an automated workflow (.github/workflows/update_schedules.yml) that runs daily at 3:00 AM UTC. It downloads the newest schedules and updates the data/ directory automatically.
