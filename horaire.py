import pdfplumber
import pandas as pd
import re

def extract_course_info(pdf_path):
    """
    Extract course information from PDF using text extraction.
    """
    all_courses = []
    
    with pdfplumber.open(pdf_path) as pdf:
        print(f"Total pages: {len(pdf.pages)}")
        
        for page_num, page in enumerate(pdf.pages, start=1):
            print(f"Processing page {page_num}...")
            
            text = page.extract_text()
            if text:
                courses = parse_page_text(text, page_num)
                print(f"  Extracted {len(courses)} schedule entries")
                all_courses.extend(courses)
    
    df = pd.DataFrame(all_courses)
    
    if not df.empty:
        df = clean_course_data(df)
    
    return df

def parse_page_text(text, page_num):
    """
    Parse course information from page text.
    Format: COURSE_CODE COURSE_NAME on one line
    Then: GR DAY TIME ACTIVITY MODE ROOM on one line
    """
    courses = []
    lines = text.split('\n')
    
    current_course_code = None
    current_course_name = None
    
    for line in lines:
        line = line.strip()
        
        if not line:
            continue
        
        # Skip headers and page info
        if any(x in line for x in ['ÉCOLE DE TECHNOLOGIE', 'Bureau du registraire', 'HORAIRE HIVER', 
                                     'Locaux A:', 'Locaux B:', 'AVIS IMPORTANT', 'Mode d\'ens.',
                                     'Dates limites', 'L\'École se réserve']):
            continue
        
        # Pattern 1: Course code and name on same line
        # Example: CHM131 CHIMIE ET MATÉRIAUX
        course_match = re.match(r'^([A-Z]{3}\d{3})\s+(.+)$', line)
        
        if course_match:
            current_course_code = course_match.group(1)
            course_name_raw = course_match.group(2).strip()
            
            # Clean up course name - remove prerequisites if present
            current_course_name = re.sub(r'\s+(GIA\d{3}|GTI\d{3}|LOG\d{3}|MAT\d{3}|STA\d{3}|CTN\d{3}|ING\d{3}|Min\.|Minimum|Cr[eé]dits?|crédits?).*', '', course_name_raw)
            
        # Pattern 2: Schedule line with group number at start
        # Example: 01 Ven 13:30 - 17:00 C P
        # Pattern: GR DAY HH:MM - HH:MM ACTIVITY MODE ROOM
        schedule_match = re.match(
            r'^(\d{2})\s+(Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+([A-Za-z/+\-]+)\s*([PDHC])?\s*(.*)$',
            line
        )
        
        if schedule_match and current_course_code:
            group_num = schedule_match.group(1)
            day = schedule_match.group(2)
            start_time = schedule_match.group(3)
            end_time = schedule_match.group(4)
            activity_type = schedule_match.group(5).strip()
            mode = schedule_match.group(6) if schedule_match.group(6) else ''
            room_raw = schedule_match.group(7).strip() if schedule_match.group(7) else ''
            
            # Parse room information more carefully
            # Sometimes room and other info get mixed (e.g., "A+B P A-3346")
            room = ''
            if room_raw:
                # Look for room pattern like A-3346
                room_match = re.search(r'([A-Z]-\d{4})', room_raw)
                if room_match:
                    room = room_match.group(1)
                elif not any(x in room_raw for x in ['A+B', 'P', 'D', 'H']):
                    # If it doesn't contain mode/group markers, keep it as room
                    room = room_raw
            
            courses.append({
                'page': page_num,
                'course_code': current_course_code,
                'course_name': current_course_name,
                'group': group_num,
                'day': day,
                'start_time': start_time,
                'end_time': end_time,
                'activity_type': activity_type,
                'mode': mode,
                'room': room
            })
            continue
        
        # Pattern 3: Continuation line (no group number, starts with day)
        # Example: Lun 13:30 - 16:30 TP P
        continuation_match = re.match(
            r'^(Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+([A-Za-z/+\-]+)\s*([PDHC])?\s*(.*)$',
            line
        )
        
        if continuation_match and current_course_code and courses:
            # This is an additional time slot for the same group
            last_group = courses[-1]['group']
            
            day = continuation_match.group(1)
            start_time = continuation_match.group(2)
            end_time = continuation_match.group(3)
            activity_type = continuation_match.group(4).strip()
            mode = continuation_match.group(5) if continuation_match.group(5) else ''
            room_raw = continuation_match.group(6).strip() if continuation_match.group(6) else ''
            
            # Parse room information
            room = ''
            if room_raw:
                room_match = re.search(r'([A-Z]-\d{4})', room_raw)
                if room_match:
                    room = room_match.group(1)
                elif not any(x in room_raw for x in ['A+B', 'P', 'D', 'H']):
                    room = room_raw
            
            courses.append({
                'page': page_num,
                'course_code': current_course_code,
                'course_name': current_course_name,
                'group': last_group,
                'day': day,
                'start_time': start_time,
                'end_time': end_time,
                'activity_type': activity_type,
                'mode': mode,
                'room': room
            })
    
    return courses

def clean_course_data(df):
    """
    Clean and standardize course data.
    """
    # Remove rows with missing essential data
    df = df[df['course_code'].notna() & (df['course_code'] != '')]
    df = df[df['day'].notna() & (df['day'] != '')]
    df = df[df['start_time'].notna() & (df['start_time'] != '')]
    
    # Fill missing values
    df = df.fillna('')
    
    # Remove extra whitespace
    for col in df.columns:
        if df[col].dtype == 'object':
            df[col] = df[col].str.strip()
            df[col] = df[col].str.replace(r'\s+', ' ', regex=True)
    
    # Standardize day abbreviations
    day_mapping = {
        'Lun': 'Monday',
        'Mar': 'Tuesday',
        'Mer': 'Wednesday',
        'Jeu': 'Thursday',
        'Ven': 'Friday',
        'Sam': 'Saturday',
        'Dim': 'Sunday'
    }
    df['day'] = df['day'].replace(day_mapping)
    
    # Standardize mode
    mode_mapping = {
        'P': 'In-person',
        'D': 'Distance',
        'H': 'Hybrid',
        'C': 'In-person'
    }
    df['mode'] = df['mode'].replace(mode_mapping)
    
    # Clean and standardize activity types
    activity_mapping = {
        'C': 'Lecture',
        'TP': 'Lab',
        'Labo': 'Lab',
        'TP-Labo': 'Lab',
        'TP/Labo': 'Lab',
        'Atelier': 'Workshop',
        'Projet': 'Project',
        'Projets': 'Project'
    }
    
    # Handle A+B notation (split groups)
    df['activity_type'] = df['activity_type'].str.replace('A\+B', '', regex=True).str.strip()
    
    # Apply mapping
    for old, new in activity_mapping.items():
        df.loc[df['activity_type'].str.startswith(old), 'activity_type'] = new
    
    # Handle Lab A, Lab B notation
    df.loc[df['activity_type'].str.contains('Labo A', case=False), 'activity_type'] = 'Lab A'
    df.loc[df['activity_type'].str.contains('Labo B', case=False), 'activity_type'] = 'Lab B'
    df.loc[df['activity_type'].str.contains('TP A', case=False), 'activity_type'] = 'Lab A'
    df.loc[df['activity_type'].str.contains('TP B', case=False), 'activity_type'] = 'Lab B'
    
    # Remove duplicate entries
    df = df.drop_duplicates()
    
    # Sort by course code, group, day, start time
    df = df.sort_values(['course_code', 'group', 'day', 'start_time'])
    df = df.reset_index(drop=True)
    
    return df

def main():
    """
    Main function to extract course data and save to CSV.
    """
    pdf_path = "HorairePublication_20263_7084.pdf"
    output_csv = "courses_schedule.csv"
    
    print(f"Extracting course information from {pdf_path}...\n")
    
    try:
        courses_df = extract_course_info(pdf_path)
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return
    
    if courses_df.empty:
        print("\n❌ No course information found in the PDF.")
        return
    
    print(f"\n✓ Successfully extracted {len(courses_df)} schedule entries!")
    
    # Display sample
    print("\n📋 Sample entries (first 30):")
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', None)
    pd.set_option('display.max_colwidth', 50)
    print(courses_df.head(30).to_string(index=False))
    
    # Save to CSV
    courses_df.to_csv(output_csv, index=False, encoding='utf-8-sig')
    print(f"\n✓ Course data saved to {output_csv}")
    
    # Statistics
    print(f"\n📊 Statistics:")
    print(f"  - Total schedule entries: {len(courses_df)}")
    print(f"  - Unique courses: {courses_df['course_code'].nunique()}")
    
    course_groups = courses_df[['course_code', 'group']].drop_duplicates()
    print(f"  - Course-group combinations: {len(course_groups)}")
    
    if not courses_df['activity_type'].empty:
        print("\n  📚 Activity types:")
        for activity, count in courses_df['activity_type'].value_counts().items():
            if activity:  # Skip empty
                print(f"    {activity}: {count}")
    
    if not courses_df['day'].empty:
        print("\n  📅 Classes by day:")
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        day_counts = courses_df['day'].value_counts()
        for day in day_order:
            if day in day_counts:
                print(f"    {day}: {day_counts[day]}")
    
    if not courses_df['mode'].empty:
        print("\n  🏫 Delivery mode:")
        for mode, count in courses_df['mode'].value_counts().items():
            if mode:  # Skip empty
                print(f"    {mode}: {count}")
    
    print("\n✨ Ready for schedule generation!")

if __name__ == "__main__":
    main()