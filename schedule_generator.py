import csv
import json
from datetime import datetime
from itertools import combinations, product

# -------------------------------------------------------
# Utility functions
# -------------------------------------------------------

def parse_time(time_str):
    """Convert time string to minutes since midnight"""
    return int(time_str.split(':')[0]) * 60 + int(time_str.split(':')[1])


def times_overlap(start1, end1, start2, end2):
    """Check if two time ranges overlap"""
    return start1 < end2 and start2 < end1


def schedules_conflict(schedule1, schedule2):
    """Check if two course schedules have any time conflicts"""
    for day1, times1 in schedule1.items():
        if day1 in schedule2:
            for start1, end1, _, _ in times1:
                for start2, end2, _, _ in schedule2[day1]:
                    if times_overlap(start1, end1, start2, end2):
                        return True
    return False


# -------------------------------------------------------
# Loading and organizing course data
# -------------------------------------------------------

def load_courses(filename):
    """Load courses from CSV, organizing by course code and group"""
    courses = {}

    with open(filename, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            course_code = row['course_code']
            group = row['group']

            # Skip invalid entries
            if not course_code or not group or not row['day']:
                continue

            course_group_key = f"{course_code}-{group}"

            if course_group_key not in courses:
                courses[course_group_key] = {
                    'code': course_code,
                    'group': group,
                    'name': row['course_name'],
                    'schedule': {}
                }

            day = row['day']
            start = parse_time(row['start_time'])
            end = parse_time(row['end_time'])
            activity = row['activity_type']
            mode = row.get('mode', 'Unknown')

            if day not in courses[course_group_key]['schedule']:
                courses[course_group_key]['schedule'][day] = []

            courses[course_group_key]['schedule'][day].append((start, end, activity, mode))

    return courses


def organize_by_course(courses):
    """Organize course groups by base course code"""
    by_course = {}
    for course_group_key, data in courses.items():
        code = data['code']
        if code not in by_course:
            by_course[code] = []
        by_course[code].append((course_group_key, data))
    return by_course


# -------------------------------------------------------
# Schedule generation and validation
# -------------------------------------------------------

def generate_schedules(courses_by_code, selected_courses):
    """Generate all valid schedule combinations for the selected courses"""
    if not selected_courses:
        print("No courses selected!")
        return []

    # Get all possible groups for each selected course
    course_options = []
    for course_code in selected_courses:
        if course_code in courses_by_code:
            course_options.append(courses_by_code[course_code])
        else:
            print(f"Warning: Course {course_code} not found in data")
            return []

    valid_schedules = []

    for combination in product(*course_options):
        schedules = [group_data['schedule'] for _, group_data in combination]
        has_conflict = False
        for i in range(len(schedules)):
            for j in range(i + 1, len(schedules)):
                if schedules_conflict(schedules[i], schedules[j]):
                    has_conflict = True
                    break
            if has_conflict:
                break

        if not has_conflict:
            valid_schedules.append(combination)

    return valid_schedules


# -------------------------------------------------------
# Formatting and exporting
# -------------------------------------------------------

def format_time(minutes):
    """Convert minutes since midnight to HH:MM format"""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


def export_all_combinations_to_json(all_schedules, filename='all_schedules.json'):
    """Export all valid schedule combinations to JSON"""
    schedules_data = []

    for i, schedule_data in enumerate(all_schedules, 1):
        schedule_obj = {
            'id': i,
            'course_combination': schedule_data['course_combo'],
            'courses': []
        }

        for course_key, course_data in schedule_data['schedule']:
            course_obj = {
                'code': course_data['code'],
                'group': course_data['group'],
                'name': course_data['name'],
                'sessions': []
            }

            day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            for day in day_order:
                if day in course_data['schedule']:
                    for start, end, activity, mode in sorted(course_data['schedule'][day]):
                        course_obj['sessions'].append({
                            'day': day,
                            'start': format_time(start),
                            'end': format_time(end),
                            'type': activity,
                            'mode': mode
                        })

            schedule_obj['courses'].append(course_obj)

        schedules_data.append(schedule_obj)

    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(schedules_data, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*80}")
    print(f"✓ All schedules exported to {filename}")
    print(f"Total valid schedules found: {len(schedules_data)}")
    print(f"{'='*80}")

    return schedules_data


# -------------------------------------------------------
# Main logic
# -------------------------------------------------------

def main():
    # Load course data
    courses = load_courses('courses_schedule.csv')
    courses_by_code = organize_by_course(courses)

    print("Available courses:")
    for code in sorted(courses_by_code.keys()):
        groups = [g for _, g in courses_by_code[code]]
        print(f"  {code}: {len(groups)} group(s) available")

    print("\n" + "="*80)
    print(f"Target: Generate all possible 4-course schedules (no time overlap)")
    print("="*80)

    # Define your course list
    general_courses = [
        'GTI650', 'LOG460', 'LOG635', 'LOG645', 'LOG680',
        'LOG710', 'LOG721', 'LOG725', 'LOG750', 'LOG795'
    ]

    # Define courses to exclude from consideration (e.g., due to conflicts or preferences)
    # Add or remove course codes here as needed
    excluded_courses = ['LOG635', 'GTI650', 'LOG645']

    # Filter available vs missing (now excluding specified courses)
    available_courses = [c for c in general_courses if c not in excluded_courses and c in courses_by_code]
    missing_courses = [c for c in general_courses if c not in courses_by_code]

    if missing_courses:
        print("\n⚠ Skipping missing courses:")
        for c in missing_courses:
            print(f"  - {c}")

    print(f"\n{len(available_courses)} valid general courses will be used.")

    # Define required courses that must be included in every schedule
    required_courses = ['LOG795']

    # Check if required courses are available
    unavailable_required = [c for c in required_courses if c not in available_courses]
    if unavailable_required:
        print(f"\n⚠ Required courses not available: {', '.join(unavailable_required)}")
        print("Please adjust required_courses to only include available courses.")
        return

    num_required = len(required_courses)
    if num_required > 4:
        print(f"\n⚠ Too many required courses ({num_required}). Maximum is 4.")
        return

    print(f"\nRequired courses: {', '.join(required_courses)} ({num_required} courses)")
    print(f"Need {4 - num_required} more courses from {len(available_courses) - num_required} optional courses.")

    if len(available_courses) - num_required < 4 - num_required:
        print("\n⚠ Not enough optional courses to fill the schedule.")
        return

    all_valid_schedules = []
    total_combinations = 0

    # Generate combinations for the remaining spots
    optional_courses = [c for c in available_courses if c not in required_courses]
    num_additional = 4 - num_required

    for course_combo in combinations(optional_courses, num_additional):
        # Combine required and additional courses
        full_combo = list(required_courses) + list(course_combo)
        total_combinations += 1
        valid_schedules = generate_schedules(courses_by_code, full_combo)
        if valid_schedules:
            print(f"✓ {', '.join(full_combo)}: {len(valid_schedules)} valid schedule(s)")
            for schedule in valid_schedules:
                all_valid_schedules.append({
                    'course_combo': full_combo,
                    'schedule': schedule
                })
        else:
            print(f"✗ {', '.join(full_combo)}: conflicts found")

    print("="*80)
    print(f"Total 4-course combinations tested: {total_combinations}")
    print(f"Valid schedules found: {len(all_valid_schedules)}")
    print("="*80)

    if all_valid_schedules:
        export_all_combinations_to_json(all_valid_schedules, 'all_schedules.json')


if __name__ == "__main__":
    main()
