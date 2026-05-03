(() => {
// ─── State ───
let allCourses = {};
let requiredCourses = [];
let optionalCourses = [];
let totalPerSchedule = 4;
let schedules = [], sorted = [], idx = 0, view = 'calendar';
let searchQuery = '', filterDept = 'all';
let globalConstraints = { daysOff: [], noMorning: false, noAfternoon: false, noEvening: false, distanceOnly: false, maxGap: 6 };
let courseConstraints = {};
let favorites = new Set();
let showOnlyFavs = false;
let slideDir = 'left';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri'];
const COLORS = ['#6c63ff','#00d4aa','#ff6b9d','#ffa94d','#45b7d1','#96e6a1','#dda0dd','#f0e68c'];
const slots = [];
for (let h = 8; h <= 23; h++) { slots.push(`${String(h).padStart(2,'0')}:00`); if (h < 23) slots.push(`${String(h).padStart(2,'0')}:30`); }

// ─── Helpers ───
const parseTime = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const fmtTime = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function getModeClass(mode) {
  if (!mode) return 'unknown';
  const l = mode.toLowerCase();
  if (l.includes('in-person')) return 'in-person';
  if (l.includes('distance')) return 'online';
  if (l.includes('hybrid')) return 'hybrid';
  return 'unknown';
}
function toast(msg, type='info') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── CSV Loading ───
async function loadCSV(sem, prog) {
  // Reset state
  allCourses = {};
  requiredCourses = [];
  optionalCourses = [];
  schedules = [];
  sorted = [];
  idx = 0;
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  courseConstraints = {};
  globalConstraints = { daysOff: [], noMorning: false, noAfternoon: false, noEvening: false, distanceOnly: false, maxGap: 6 };
  document.querySelectorAll('.day-pill').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.toggle-row').forEach(el => el.classList.remove('active'));
  if(document.getElementById('maxGapSlider')){document.getElementById('maxGapSlider').value=6;document.getElementById('maxGapValue').textContent='No limit';}
  
  document.getElementById('configPhase').classList.remove('active');
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('error').style.display = 'none';

  try {
    const r = await fetch(`data/${sem}_${prog}.csv`);
    if (!r.ok) throw new Error('Schedule data not found for this program and semester.');
    const text = await r.text();
    parseCSVData(text);
    
    // Update badge
    const semText = document.getElementById('semesterSelect').options[document.getElementById('semesterSelect').selectedIndex].text;
    const progText = document.getElementById('programSelect').options[document.getElementById('programSelect').selectedIndex].text;
    document.getElementById('headerBadge').textContent = `${semText} · ${progText}`;

    renderSelectionSummary();
    buildFilterPills();
    renderCatalog();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('selectionPhase').classList.add('active');
  } catch(e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('errorDetails').textContent = e.message;
    // Show back button to try again
    const backBtn = document.createElement('button');
    backBtn.className = 'generate-btn';
    backBtn.style.marginTop = '16px';
    backBtn.textContent = '← Go Back';
    backBtn.onclick = () => {
        document.getElementById('error').style.display = 'none';
        document.getElementById('configPhase').classList.add('active');
        document.getElementById('headerBadge').textContent = 'Program Selection';
    };
    document.getElementById('error').appendChild(backBtn);
  }
}

function parseCSVData(csv) {
  const lines = csv.trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const [, code, name, grp, day, start, end, type, mode, room] = vals;
    if (!code || !day || !start) continue;
    if (!allCourses[code]) allCourses[code] = { name: name || '', groups: {} };
    if (name && name.length > allCourses[code].name.length) allCourses[code].name = name;
    if (!allCourses[code].groups[grp]) allCourses[code].groups[grp] = [];
    allCourses[code].groups[grp].push({ day, start, end, type: type||'', mode: mode||'', room: room||'' });
  }
  // Post-process: fill empty modes by inheriting from same group's lecture, or same course
  for (const code in allCourses) {
    for (const grp in allCourses[code].groups) {
      const sessions = allCourses[code].groups[grp];
      // Find the mode from sessions that have one (prefer Lecture type)
      let groupMode = '';
      for (const s of sessions) {
        if (s.mode) { groupMode = s.mode; if (s.type === 'Lecture') break; }
      }
      // If no mode found in this group, check other groups of the same course
      if (!groupMode) {
        for (const g2 in allCourses[code].groups) {
          for (const s of allCourses[code].groups[g2]) {
            if (s.mode) { groupMode = s.mode; break; }
          }
          if (groupMode) break;
        }
      }
      // Apply to empty sessions
      if (groupMode) {
        for (const s of sessions) { if (!s.mode) s.mode = groupMode; }
      }
    }
  }
}

// ─── Dynamic Filters ───
function buildFilterPills() {
  const prefixes = new Set();
  Object.keys(allCourses).forEach(c => prefixes.add(c.replace(/\d+/,'')));
  const row = document.getElementById('filterRow');
  const sorted = [...prefixes].sort();
  row.innerHTML = '<button class="filter-pill active" data-filter="all">All</button>' +
    sorted.map(p => `<button class="filter-pill" data-filter="${p}">${p}</button>`).join('') +
    '<button class="filter-pill" data-filter="other">Other</button>';
  row.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterDept = btn.dataset.filter;
      renderCatalog();
    });
  });
}

// ─── Schedule Engine ───
function timesOverlap(s1,e1,s2,e2) { return s1 < e2 && s2 < e1; }

function groupsConflict(sessionsA, sessionsB) {
  for (const a of sessionsA)
    for (const b of sessionsB)
      if (a.day === b.day && timesOverlap(parseTime(a.start),parseTime(a.end),parseTime(b.start),parseTime(b.end)))
        return true;
  return false;
}

function cartesian(arrays) {
  if (!arrays.length) return [[]];
  return arrays.reduce((acc, arr) => {
    const res = [];
    for (const a of acc) for (const b of arr) res.push([...a, b]);
    return res;
  }, [[]]);
}

function sessionViolatesGlobal(session) {
  if (globalConstraints.daysOff.includes(session.day)) return true;
  const start = parseTime(session.start);
  if (globalConstraints.noMorning && start < 13*60) return true;
  if (globalConstraints.noAfternoon && start >= 13*60 && start < 17.5*60) return true;
  if (globalConstraints.noEvening && start >= 17.5*60) return true;
  if (globalConstraints.distanceOnly) {
    const m = (session.mode||'').toLowerCase();
    if (!m.includes('distance')) return true;
  }
  return false;
}

function scheduleExceedsMaxGap(groups) {
  if (globalConstraints.maxGap >= 6) return false;
  const maxMin = globalConstraints.maxGap * 60;
  for (const day of [...DAYS, 'Saturday']) {
    const times = [];
    groups.forEach(g => g.sessions.filter(s => s.day===day).forEach(s => times.push([parseTime(s.start),parseTime(s.end)])));
    if (times.length < 2) continue;
    times.sort((a,b) => a[0]-b[0]);
    for (let i = 1; i < times.length; i++) {
      if (times[i][0] - times[i-1][1] > maxMin) return true;
    }
  }
  return false;
}

function generateAllSchedules(courseCodes) {
  const groupOptions = courseCodes.map(code => {
    const c = allCourses[code];
    const allowed = courseConstraints[code]?.allowedGroups || Object.keys(c.groups);
    return Object.entries(c.groups)
      .filter(([grp, sessions]) => {
         if (!allowed.includes(grp)) return false;
         for (const s of sessions) {
             if (sessionViolatesGlobal(s)) return false;
         }
         return true;
      })
      .map(([grp, sessions]) => ({ code, name: c.name, group: grp, sessions }));
  });
  
  if (groupOptions.some(opt => opt.length === 0)) return []; // Constraints eliminated all groups for a course
  
  const combos = cartesian(groupOptions);
  const valid = [];
  for (const combo of combos) {
    let conflict = false;
    outer: for (let i = 0; i < combo.length; i++)
      for (let j = i+1; j < combo.length; j++)
        if (groupsConflict(combo[i].sessions, combo[j].sessions)) { conflict = true; break outer; }
    if (!conflict) {
      if (!scheduleExceedsMaxGap(combo)) valid.push(combo);
    }
  }
  return valid;
}

function runGeneration() {
  const nReq = requiredCourses.length;
  const nOpt = totalPerSchedule - nReq;
  if (nOpt < 0) { toast('Too many required courses for the selected total','error'); return; }
  if (nOpt > optionalCourses.length) { toast(`Need ${nOpt} optional courses but only ${optionalCourses.length} selected`,'error'); return; }

  // Show overlay
  const ov = document.createElement('div');
  ov.className = 'generating-overlay';
  ov.innerHTML = '<div class="spinner"></div><p>Generating schedules…</p>';
  document.body.appendChild(ov);

  setTimeout(() => {
    const allValid = [];
    const optCombos = combinations(optionalCourses, nOpt);
    for (const optCombo of optCombos) {
      const full = [...requiredCourses, ...optCombo];
      const valid = generateAllSchedules(full);
      for (const v of valid) allValid.push({ courseCodes: full, groups: v });
    }

    ov.remove();
    if (!allValid.length) {
      toast('No conflict-free schedules found. Try different courses.','error');
      return;
    }

    // Convert to viewer format
    schedules = allValid.map((s, i) => ({
      id: i+1,
      course_combination: s.courseCodes,
      courses: s.groups.map(g => ({
        code: g.code, group: g.group, name: g.name,
        sessions: g.sessions.map(se => ({ day: se.day, start: se.start, end: se.end, type: se.type, mode: se.mode, room: se.room||'' }))
      }))
    }));
    sorted = [...schedules];
    sorted.sort((a,b) => calcScore(b)-calcScore(a));
    idx = 0;
    toast(`Found ${schedules.length} valid schedule(s)!`, 'success');
    showResults();
  }, 50);
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const res = [];
  function combine(start, combo) {
    if (combo.length === k) { res.push([...combo]); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]);
      combine(i+1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return res;
}

// ─── Catalog Rendering ───
function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  const empty = document.getElementById('catalogEmpty');
  const codes = Object.keys(allCourses).sort();
  const q = searchQuery.toLowerCase();

  const filtered = codes.filter(code => {
    if (filterDept !== 'all') {
      const prefix = code.replace(/\d+/,'');
      const knownPrefixes = [...new Set(codes.map(c=>c.replace(/\d+/,'')))];
      if (filterDept === 'other') { if (knownPrefixes.slice(0,knownPrefixes.length-1).includes(prefix)) return false; }
      else if (prefix !== filterDept) return false;
    }
    if (q) {
      return code.toLowerCase().includes(q) || allCourses[code].name.toLowerCase().includes(q);
    }
    return true;
  });

  if (!filtered.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = filtered.map(code => {
    const c = allCourses[code];
    const nGroups = Object.keys(c.groups).length;
    const modes = new Set();
    Object.values(c.groups).forEach(sessions => sessions.forEach(s => { if (s.mode) modes.add(s.mode); }));
    const isReq = requiredCourses.includes(code);
    const isOpt = optionalCourses.includes(code);
    const selected = isReq || isOpt;

    return `<div class="catalog-card ${selected?'selected':''}" data-code="${code}">
      <div class="catalog-card-header">
        <span class="catalog-card-code">${code}</span>
        <span class="catalog-card-groups">${nGroups} grp${nGroups>1?'s':''}</span>
      </div>
      <div class="catalog-card-name">${c.name}</div>
      <div class="catalog-card-meta">
        ${[...modes].map(m => `<span class="mode-tag ${getModeClass(m)}">${m}</span>`).join('')}
      </div>
      <div class="catalog-card-actions">
        <button class="add-btn req-btn" ${selected?'disabled':''} onclick="window._app.addCourse('${code}','required')">+ Required</button>
        <button class="add-btn opt-btn" ${selected?'disabled':''} onclick="window._app.addCourse('${code}','optional')">+ Optional</button>
      </div>
      <div class="group-chips-container">
        <div class="group-chips-header">Allowed Groups</div>
        <div class="group-chips-list">
          ${Object.keys(c.groups).map(g => {
            const isActive = !courseConstraints[code] || courseConstraints[code].allowedGroups.includes(g);
            return `<div class="group-chip ${isActive ? 'active' : ''}" onclick="window._app.toggleGroup('${code}', '${g}')">Gr.${g}</div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Selection Management ───
function addCourse(code, type) {
  if (requiredCourses.includes(code) || optionalCourses.includes(code)) return;
  if (type === 'required') requiredCourses.push(code);
  else optionalCourses.push(code);
  courseConstraints[code] = { allowedGroups: Object.keys(allCourses[code].groups) };
  renderSelectionSummary();
  renderCatalog();
}

function removeCourse(code) {
  requiredCourses = requiredCourses.filter(c => c !== code);
  optionalCourses = optionalCourses.filter(c => c !== code);
  delete courseConstraints[code];
  renderSelectionSummary();
  renderCatalog();
}

function toggleGroup(code, grp) {
  if (!courseConstraints[code]) courseConstraints[code] = { allowedGroups: Object.keys(allCourses[code].groups) };
  const idx = courseConstraints[code].allowedGroups.indexOf(grp);
  if (idx > -1) {
    if (courseConstraints[code].allowedGroups.length === 1) {
      toast('Must select at least one group', 'error');
      return;
    }
    courseConstraints[code].allowedGroups.splice(idx, 1);
  } else {
    courseConstraints[code].allowedGroups.push(grp);
  }
  renderCatalog();
}

function renderSelectionSummary() {
  const reqChips = document.getElementById('requiredChips');
  const optChips = document.getElementById('optionalChips');
  document.getElementById('reqCount').textContent = requiredCourses.length;
  document.getElementById('optCount').textContent = optionalCourses.length;

  reqChips.innerHTML = requiredCourses.length
    ? requiredCourses.map(c => `<span class="sel-chip required">${c}<button class="chip-remove" onclick="window._app.removeCourse('${c}')">×</button></span>`).join('')
    : '<span class="bucket-empty">Click "+ Required" on courses below</span>';
  optChips.innerHTML = optionalCourses.length
    ? optionalCourses.map(c => `<span class="sel-chip optional">${c}<button class="chip-remove" onclick="window._app.removeCourse('${c}')">×</button></span>`).join('')
    : '<span class="bucket-empty">Click "+ Optional" on courses below</span>';

  updateConfigInfo();
}

function updateConfigInfo() {
  const info = document.getElementById('configInfo');
  const btn = document.getElementById('generateBtn');
  const nReq = requiredCourses.length;
  const nOpt = optionalCourses.length;
  const total = totalPerSchedule;

  if (nReq > total) {
    info.textContent = `⚠ Too many required (${nReq}) for ${total} total`;
    info.style.color = 'var(--accent-3)';
    btn.disabled = true; btn.classList.remove('ready');
  } else if (nReq + nOpt < total) {
    const need = total - nReq;
    info.textContent = `Need ${need} optional course${need>1?'s':''}, have ${nOpt}`;
    info.style.color = 'var(--text-muted)';
    btn.disabled = true; btn.classList.remove('ready');
  } else {
    const need = total - nReq;
    info.textContent = `✓ Will pick ${need} from ${nOpt} optional + ${nReq} required`;
    info.style.color = 'var(--accent-2)';
    btn.disabled = false; btn.classList.add('ready');
  }
  document.getElementById('courseCount').textContent = total;
}

// ─── Phase Switching ───
function showResults() {
  document.getElementById('selectionPhase').classList.remove('active');
  document.getElementById('resultsPhase').classList.add('active');
  document.querySelector('.app-header p').textContent = `${sorted.length} schedule${sorted.length>1?'s':''} found — browse & compare`;
  updateFavUI();
  renderSchedule();
}

function goBack() {
  document.getElementById('resultsPhase').classList.remove('active');
  document.getElementById('selectionPhase').classList.add('active');
  document.querySelector('.app-header p').textContent = 'Select your courses and generate conflict-free schedules';
}

// ─── Scoring ───
function calcScore(s) {
  let score = 50;
  const days = getActiveDays(s);
  score += (5 - days) * 8;
  const gap = getGapMinutes(s);
  score -= Math.min(gap / 30, 20);
  const earliest = getEarliestStart(s);
  score += Math.min((earliest - 480) / 30, 10);
  const dist = getDistanceCount(s);
  score += dist * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Favorites ───
function toggleFav() {
  const id = sorted[idx]?.id;
  if (!id) return;
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  updateFavUI();
  renderSchedule();
}
function updateFavUI() {
  const cnt = favorites.size;
  const badge = document.getElementById('favCount');
  badge.textContent = cnt;
  badge.style.display = cnt > 0 ? 'inline' : 'none';
}
function toggleFavFilter() {
  showOnlyFavs = !showOnlyFavs;
  document.getElementById('favFilterBtn').classList.toggle('active', showOnlyFavs);
  if (showOnlyFavs) {
    sorted = schedules.filter(s => favorites.has(s.id));
    if (!sorted.length) { toast('No favorites yet — star some schedules first','error'); showOnlyFavs=false; document.getElementById('favFilterBtn').classList.remove('active'); sorted=[...schedules]; }
  } else { sorted = [...schedules]; }
  idx = 0; renderSchedule();
}

// ─── Export ───
function exportCopy() {
  const s = sorted[idx]; if(!s) return;
  let txt = `ETS Schedule #${s.id}\n${'='.repeat(30)}\n`;
  s.courses.forEach(c => {
    txt += `\n${c.code} — ${c.name} (Group ${c.group})\n`;
    c.sessions.forEach(se => { txt += `  ${se.day} ${se.start}–${se.end} | ${se.type} | ${se.mode||'N/A'}\n`; });
  });
  navigator.clipboard.writeText(txt).then(() => toast('Copied to clipboard!','success'));
}
function exportICS() {
  const s = sorted[idx]; if(!s) return;
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//ETS Schedule Planner//EN\n';
  const baseDate = {Monday:'20260907',Tuesday:'20260908',Wednesday:'20260909',Thursday:'20260910',Friday:'20260911',Saturday:'20260912'};
  s.courses.forEach(c => {
    c.sessions.forEach(se => {
      const d = baseDate[se.day]||'20260907';
      const st = se.start.replace(':','')+'00'; const et = se.end.replace(':','')+'00';
      ics += `BEGIN:VEVENT\nDTSTART:${d}T${st}\nDTEND:${d}T${et}\nRRULE:FREQ=WEEKLY;COUNT=15\nSUMMARY:${c.code} - ${se.type}\nDESCRIPTION:${c.name} | Group ${c.group} | ${se.mode||''}\nLOCATION:ÉTS\nEND:VEVENT\n`;
    });
  });
  ics += 'END:VCALENDAR';
  const blob = new Blob([ics],{type:'text/calendar'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`schedule_${s.id}.ics`; a.click();
  toast('ICS file downloaded!','success');
}

// ─── Results Rendering ───
function getCourseColorMap(s) {
  const map = {};
  s.courses.forEach((c,i) => { map[c.code] = COLORS[i % COLORS.length]; });
  return map;
}
function getDistanceCount(s) { return s.courses.reduce((sum,c) => sum + c.sessions.filter(se => se.mode && se.mode.toLowerCase().includes('distance')).length, 0); }
function getActiveDays(s) { const d = new Set(); s.courses.forEach(c => c.sessions.forEach(se => d.add(se.day))); return d.size; }
function getEarliestStart(s) { let e=1440; s.courses.forEach(c => c.sessions.forEach(se => { const t=parseTime(se.start); if(t<e)e=t; })); return e; }
function getGapMinutes(s) {
  let totalGap = 0;
  for (const day of DAYS) {
    const times = [];
    s.courses.forEach(c => c.sessions.filter(se => se.day===day).forEach(se => times.push([parseTime(se.start),parseTime(se.end)])));
    if (times.length < 2) continue;
    times.sort((a,b) => a[0]-b[0]);
    for (let i = 1; i < times.length; i++) totalGap += Math.max(0, times[i][0] - times[i-1][1]);
  }
  return totalGap;
}

function sortSchedules(method) {
  sorted = showOnlyFavs ? schedules.filter(s => favorites.has(s.id)) : [...schedules];
  switch(method) {
    case 'score': sorted.sort((a,b) => calcScore(b)-calcScore(a)); break;
    case 'distance-desc': sorted.sort((a,b) => getDistanceCount(b)-getDistanceCount(a)); break;
    case 'distance-asc': sorted.sort((a,b) => getDistanceCount(a)-getDistanceCount(b)); break;
    case 'compact': sorted.sort((a,b) => getActiveDays(a)-getActiveDays(b)); break;
    case 'earliest': sorted.sort((a,b) => getEarliestStart(b)-getEarliestStart(a)); break;
    case 'gaps': sorted.sort((a,b) => getGapMinutes(a)-getGapMinutes(b)); break;
  }
  idx = 0; renderSchedule();
}

function renderSchedule() {
  document.getElementById('scheduleCounter').innerHTML = `${idx+1} <span>/ ${sorted.length}</span>`;
  const s = sorted[idx];
  // Fav button
  const fb = document.getElementById('favBtn');
  if(fb) fb.classList.toggle('active', favorites.has(s?.id));
  // Score
  const score = s ? calcScore(s) : 0;
  const sf = document.getElementById('scoreFill'); if(sf) sf.style.width = score+'%';
  const sv = document.getElementById('scoreValue'); if(sv) sv.textContent = score;
  renderStats(); renderDayBreakdown(); renderChips(); renderCalendar(); renderList();
}

function renderDayBreakdown() {
  const s = sorted[idx]; if(!s) return;
  const el = document.getElementById('dayBreakdown'); if(!el) return;
  const allDays = [...DAYS];
  s.courses.forEach(c => c.sessions.forEach(se => { if(se.day==='Saturday' && !allDays.includes('Saturday')) allDays.push('Saturday'); }));
  el.innerHTML = allDays.map(day => {
    const sessions = []; s.courses.forEach(c => c.sessions.filter(se=>se.day===day).forEach(se => sessions.push(se)));
    const hrs = sessions.reduce((sum,se) => sum+(parseTime(se.end)-parseTime(se.start))/60, 0);
    const isEmpty = sessions.length === 0;
    let times = '';
    if(!isEmpty) {
      const starts = sessions.map(se=>parseTime(se.start)).sort((a,b)=>a-b);
      const ends = sessions.map(se=>parseTime(se.end)).sort((a,b)=>b-a);
      times = `${fmtTime(starts[0])}–${fmtTime(ends[0])}`;
    }
    return `<div class="day-bar ${isEmpty?'empty':''}"><div class="day-bar-label">${day.slice(0,3)}</div><div class="day-bar-value">${isEmpty?'Free':hrs.toFixed(1)+'h'}</div>${times?`<div class="day-bar-hours">${times}</div>`:''}</div>`;
  }).join('');
}

function renderStats() {
  const s = sorted[idx];
  let ip=0, di=0;
  s.courses.forEach(c => c.sessions.forEach(se => { const mc=getModeClass(se.mode); if(mc==='in-person')ip++; else if(mc==='online')di++; }));
  const totalH = s.courses.reduce((sum,c) => sum+c.sessions.reduce((ss,se) => ss+(parseTime(se.end)-parseTime(se.start))/60,0),0);
  const gapH = (getGapMinutes(s)/60).toFixed(1);
  const earliest = fmtTime(getEarliestStart(s));
  document.getElementById('stats').innerHTML = [
    {v:s.courses.length,l:'Courses'},{v:s.courses.reduce((s2,c)=>s2+c.sessions.length,0),l:'Sessions'},
    {v:totalH.toFixed(1)+'h',l:'Weekly Hours'},{v:ip,l:'In-Person'},{v:di,l:'Distance'},
    {v:getActiveDays(s),l:'Active Days'},{v:gapH+'h',l:'Total Gaps'},{v:earliest,l:'Earliest'}
  ].map(({v,l})=>`<div class="stat-card animate-in"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`).join('');
}

function renderChips() {
  const s = sorted[idx], colors = getCourseColorMap(s);
  document.getElementById('courseChips').innerHTML = s.courses.map(c =>
    `<div class="course-chip"><div class="chip-dot" style="background:${colors[c.code]}"></div>${c.code} <span style="color:var(--text-muted);font-weight:400;margin-left:2px">Gr.${c.group}</span></div>`
  ).join('');
}

function renderCalendar() {
  const s = sorted[idx], container = document.getElementById('calendarContainer');
  const root = getComputedStyle(document.documentElement);
  const slotH = parseFloat(root.getPropertyValue('--slot-height'))||22;
  const headH = parseFloat(root.getPropertyValue('--header-height'))||36;
  const firstSlot = parseTime(slots[0]);
  const colors = getCourseColorMap(s);
  let hasSat = false;
  s.courses.forEach(c => c.sessions.forEach(se => { if(se.day==='Saturday') hasSat=true; }));
  const days = hasSat ? [...DAYS,'Saturday'] : [...DAYS];
  const dayShort = hasSat ? [...DAY_SHORT,'Sat'] : [...DAY_SHORT];
  const nCols = days.length;

  let html = '<div class="calendar-wrapper"><div class="calendar-grid'+(hasSat?' has-saturday':'')+'">';
  html += '<div class="calendar-header">Time</div>';
  dayShort.forEach(d => { html += `<div class="calendar-header">${d}</div>`; });
  slots.forEach(slot => {
    const isHour = slot.endsWith(':00');
    html += `<div class="time-label">${isHour?slot:''}</div>`;
    days.forEach(day => { html += `<div class="time-slot ${isHour?'hour-mark':''}" data-day="${day}"></div>`; });
  });
  html += '</div><div class="blocks-overlay" id="blocksOverlay"></div></div>';
  container.innerHTML = html;

  const overlay = document.getElementById('blocksOverlay');
  const grid = container.querySelector('.calendar-grid');
  const hdrCell = grid.querySelector('.calendar-header');
  const slotCell = grid.querySelector('.time-label');
  const headerH = hdrCell?hdrCell.offsetHeight:headH;
  const slotHeight = slotCell?slotCell.offsetHeight:slotH;
  const timeColW = hdrCell?hdrCell.offsetWidth:55;
  const gridW = grid.clientWidth;

  s.courses.forEach(course => {
    course.sessions.forEach(session => {
      const di = days.indexOf(session.day); if(di===-1) return;
      const start=parseTime(session.start), end=parseTime(session.end), dur=end-start;
      const top = ((start-firstSlot)/30)*slotHeight + headerH;
      const h = (dur/30)*slotHeight - 2;
      const modeClass = getModeClass(session.mode);
      const dayColW = (gridW-timeColW)/nCols;
      const left = timeColW + dayColW*di;
      const roomHtml = session.room ? `<div class="room-tag">${session.room}</div>` : '';

      const block = document.createElement('div');
      block.className = `class-block ${modeClass}`;
      block.style.cssText = `top:${top}px;height:${h}px;left:${left+2}px;width:${dayColW-4}px;border-left:3px solid ${colors[course.code]};`;
      block.dataset.code = course.code;
      block.dataset.name = course.name||'';
      block.dataset.detail = `${session.day} · ${session.start}–${session.end}\n${session.type} · ${session.mode||'N/A'}\nGroup ${course.group}${session.room?'\nRoom: '+session.room:''}`;

      if(dur<=60) {
        block.innerHTML = `<div class="class-code">${course.code}</div><div class="class-details" style="display:flex;gap:5px;justify-content:space-between"><span>${session.type}</span><span>${session.start}–${session.end}</span></div>${roomHtml}`;
        block.style.display='flex'; block.style.flexDirection='column'; block.style.justifyContent='center';
      } else {
        block.innerHTML = `<div class="class-code">${course.code}</div><div class="class-details">${session.type}</div><div class="class-details">${session.start} – ${session.end}</div><div class="class-type-badge">${session.mode||'N/A'}</div>${roomHtml}`;
      }
      block.addEventListener('mouseenter', showTooltip);
      block.addEventListener('mousemove', moveTooltip);
      block.addEventListener('mouseleave', hideTooltip);
      overlay.appendChild(block);
    });
  });
}

// ─── Tooltip ───
const tooltipEl = document.getElementById('tooltip');
function showTooltip(e) {
  document.getElementById('tooltipCode').textContent = e.currentTarget.dataset.code;
  document.getElementById('tooltipName').textContent = e.currentTarget.dataset.name;
  document.getElementById('tooltipDetail').textContent = e.currentTarget.dataset.detail;
  tooltipEl.classList.add('visible');
}
function moveTooltip(e) {
  tooltipEl.style.left = Math.min(e.clientX+14, window.innerWidth-220)+'px';
  tooltipEl.style.top = Math.min(e.clientY+14, window.innerHeight-100)+'px';
}
function hideTooltip() { tooltipEl.classList.remove('visible'); }

// ─── List View ───
function renderList() {
  const s = sorted[idx], colors = getCourseColorMap(s);
  document.getElementById('listView').innerHTML = s.courses.map(course => {
    const sessions = course.sessions.map(se => {
      const mc = getModeClass(se.mode);
      const room = se.room ? ` · ${se.room}` : '';
      return `<div class="session-row"><div class="session-day">${se.day}</div><div class="session-time">${se.start} – ${se.end}</div><div class="session-type">${se.type}${room}</div><span class="mode-badge ${mc}">${se.mode||'N/A'}</span></div>`;
    }).join('');
    return `<div class="course-card animate-in"><div class="course-card-header"><div><div class="course-card-title" style="color:${colors[course.code]}">${course.code}</div><div class="course-card-name">${course.name||''}</div></div><div class="course-card-group">Group ${course.group}</div></div>${sessions}</div>`;
  }).join('');
}

function switchView(v) {
  view = v;
  document.getElementById('calendarBtn').classList.toggle('active', v==='calendar');
  document.getElementById('listBtn').classList.toggle('active', v==='list');
  document.getElementById('calendarView').style.display = v==='calendar'?'block':'none';
  document.getElementById('listView').classList.toggle('active', v==='list');
}

function go(delta) { idx = (idx+delta+sorted.length)%sorted.length; renderSchedule(); }

// ─── Event Setup ───
function setupEvents() {
  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value;
    document.getElementById('searchClear').style.display = searchQuery?'block':'none';
    renderCatalog();
  });
  document.getElementById('searchClear').addEventListener('click', () => {
    searchQuery = ''; document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    renderCatalog();
  });
  // filter pills are now set up in buildFilterPills()
  document.getElementById('countDown').addEventListener('click', () => { if(totalPerSchedule>1){totalPerSchedule--;updateConfigInfo();} });
  document.getElementById('countUp').addEventListener('click', () => { if(totalPerSchedule<8){totalPerSchedule++;updateConfigInfo();} });
  document.getElementById('generateBtn').addEventListener('click', runGeneration);
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('prevBtn').addEventListener('click', () => go(-1));
  document.getElementById('nextBtn').addEventListener('click', () => go(1));
  document.getElementById('calendarBtn').addEventListener('click', () => switchView('calendar'));
  document.getElementById('listBtn').addEventListener('click', () => switchView('list'));
  document.getElementById('sortSelect').addEventListener('change', e => sortSchedules(e.target.value));

  // Favorites
  const favBtn = document.getElementById('favBtn');
  if(favBtn) favBtn.addEventListener('click', toggleFav);
  const favFilterBtn = document.getElementById('favFilterBtn');
  if(favFilterBtn) favFilterBtn.addEventListener('click', toggleFavFilter);

  // Export
  const exportBtn = document.getElementById('exportBtn');
  const exportMenu = document.getElementById('exportMenu');
  if(exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));
    exportMenu.addEventListener('click', e => e.stopPropagation());
  }
  const exportCopyBtn = document.getElementById('exportCopy');
  if(exportCopyBtn) exportCopyBtn.addEventListener('click', () => { exportCopy(); exportMenu.classList.remove('open'); });
  const exportICSBtn = document.getElementById('exportICS');
  if(exportICSBtn) exportICSBtn.addEventListener('click', () => { exportICS(); exportMenu.classList.remove('open'); });

  // Jump input
  const jumpInput = document.getElementById('jumpInput');
  if(jumpInput) {
    jumpInput.addEventListener('change', () => {
      const v = parseInt(jumpInput.value);
      if(v >= 1 && v <= sorted.length) { idx = v-1; renderSchedule(); }
      jumpInput.value = '';
    });
  }

  // Reset
  const resetBtn = document.getElementById('resetAllBtn');
  if(resetBtn) resetBtn.addEventListener('click', () => {
    requiredCourses = []; optionalCourses = []; courseConstraints = {};
    globalConstraints = { daysOff: [], noMorning: false, noAfternoon: false, noEvening: false, distanceOnly: false, maxGap: 6 };
    document.querySelectorAll('.day-pill').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.toggle-row').forEach(el => el.classList.remove('active'));
    if(document.getElementById('maxGapSlider')){document.getElementById('maxGapSlider').value=6;document.getElementById('maxGapValue').textContent='No limit';}
    renderSelectionSummary(); renderCatalog();
    toast('All selections reset', 'info');
  });

  document.addEventListener('keydown', e => {
    if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
    if(document.getElementById('resultsPhase').classList.contains('active')) {
      if(e.key==='ArrowLeft') go(-1);
      else if(e.key==='ArrowRight') go(1);
      else if(e.key.toLowerCase()==='c') switchView('calendar');
      else if(e.key.toLowerCase()==='l') switchView('list');
      else if(e.key.toLowerCase()==='f') toggleFav();
      else if(e.key==='Escape') goBack();
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if(view==='calendar' && document.getElementById('resultsPhase').classList.contains('active')) renderCalendar(); }, 150);
  });

  document.getElementById('loadProgramBtn').addEventListener('click', () => {
    const sem = document.getElementById('semesterSelect').value;
    const prog = document.getElementById('programSelect').value;
    loadCSV(sem, prog);
  });

  document.getElementById('backToConfigBtn').addEventListener('click', () => {
    document.getElementById('selectionPhase').classList.remove('active');
    document.getElementById('configPhase').classList.add('active');
    document.getElementById('headerBadge').textContent = 'Program Selection';
  });
  document.getElementById('openConstraintsBtn').addEventListener('click', () => {
    document.getElementById('constraintsModal').classList.add('active');
  });

  document.getElementById('closeConstraintsBtn').addEventListener('click', () => {
    document.getElementById('constraintsModal').classList.remove('active');
  });

  document.querySelectorAll('.day-pill').forEach(pill => {
    pill.addEventListener('click', () => { pill.classList.toggle('active'); });
  });

  document.querySelectorAll('.toggle-row').forEach(row => {
    row.addEventListener('click', () => { row.classList.toggle('active'); });
  });

  // Max gap slider
  const gapSlider = document.getElementById('maxGapSlider');
  const gapValue = document.getElementById('maxGapValue');
  if(gapSlider && gapValue) {
    gapSlider.addEventListener('input', () => {
      const v = parseFloat(gapSlider.value);
      gapValue.textContent = v >= 6 ? 'No limit' : v + 'h';
    });
  }

  document.getElementById('saveConstraintsBtn').addEventListener('click', () => {
    globalConstraints.daysOff = Array.from(document.querySelectorAll('.day-pill.active')).map(el => el.dataset.day);
    globalConstraints.noMorning = document.getElementById('noMorningToggle').classList.contains('active');
    globalConstraints.noAfternoon = document.getElementById('noAfternoonToggle').classList.contains('active');
    globalConstraints.noEvening = document.getElementById('noEveningToggle').classList.contains('active');
    globalConstraints.distanceOnly = document.getElementById('distanceOnlyToggle').classList.contains('active');
    globalConstraints.maxGap = parseFloat(document.getElementById('maxGapSlider').value);
    document.getElementById('constraintsModal').classList.remove('active');
    updateConstraintBadge();
    toast('Global constraints saved', 'success');
  });
}

function updateConstraintBadge() {
  let count = globalConstraints.daysOff.length;
  if(globalConstraints.noMorning) count++;
  if(globalConstraints.noAfternoon) count++;
  if(globalConstraints.noEvening) count++;
  if(globalConstraints.distanceOnly) count++;
  if(globalConstraints.maxGap < 6) count++;
  const badge = document.getElementById('constraintBadge');
  if(badge) {
    badge.textContent = count > 0 ? count : '';
    badge.className = count > 0 ? 'constraint-badge' : '';
  }
}

// ─── Public API ───
window._app = { addCourse, removeCourse, toggleGroup };

// ─── Manifest & Dynamic Dropdowns ───
let manifest = null;

async function loadManifest() {
  try {
    const r = await fetch('data/manifest.json');
    if (!r.ok) throw new Error('Manifest not found');
    manifest = await r.json();
    populateSemesters();
    toast('Course data loaded', 'info');
  } catch(e) {
    console.warn('Manifest load failed, using fallback:', e);
    // Fallback: hardcoded options
    const semSel = document.getElementById('semesterSelect');
    semSel.innerHTML = '<option value="A-2026">Automne 2026</option><option value="E-2026">Été 2026</option><option value="H-2026">Hiver 2026</option>';
    const progSel = document.getElementById('programSelect');
    progSel.innerHTML = '<option value="log">Génie logiciel</option><option value="gti">Génie des TI</option><option value="ele">Génie électrique</option><option value="mec">Génie mécanique</option><option value="ctn">Génie de la construction</option><option value="gol">Génie des opérations</option><option value="aer">Génie aérospatial</option><option value="gpa">Génie de la production</option><option value="inf">Informatique distribuée</option><option value="ux">Design UX</option>';
  }
}

function populateSemesters() {
  const semSel = document.getElementById('semesterSelect');
  // Sort: most recent first (by year desc, then season order A > E > H)
  const seasonOrder = { A: 0, E: 1, H: 2 };
  const sorted = [...manifest.semesters].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return seasonOrder[a.season] - seasonOrder[b.season];
  });
  semSel.innerHTML = sorted.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  // Update programs for selected semester
  populatePrograms();
  semSel.addEventListener('change', populatePrograms);
}

function populatePrograms() {
  const semId = document.getElementById('semesterSelect').value;
  const progSel = document.getElementById('programSelect');
  // Find which programs have data for this semester
  const availProgs = new Set(manifest.available.filter(a => a.semester === semId).map(a => a.program));
  const progs = manifest.programs.filter(p => availProgs.has(p.id));
  if (progs.length === 0) {
    progSel.innerHTML = '<option value="">No programs available</option>';
    return;
  }
  progs.sort((a, b) => a.name.localeCompare(b.name));
  progSel.innerHTML = progs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

// ─── Init ───
setupEvents();
loadManifest();
})();
