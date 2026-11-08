// Regras puras do app, sem acesso à tela nem ao armazenamento. Testadas em tests/logic.test.html.

const pad = (n) => String(n).padStart(2, '0');

// Datas são strings AAAA-MM-DD no fuso local, para um treino à noite não cair no dia seguinte em UTC.
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
export const weekdayIndex = (iso) => (fromISO(iso).getDay() + 6) % 7; // 0 = segunda
export const mondayOf = (iso) => addDays(iso, -weekdayIndex(iso));
export const nextMonday = (iso) => {
  const i = weekdayIndex(iso);
  return i === 0 ? iso : addDays(iso, 7 - i);
};

const DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/* ---------- Plano ---------- */

export function buildSchedule(plan, startDate) {
  const monday = mondayOf(startDate);
  const { days, rotation } = plan.schedule;
  const list = [];
  for (let week = 1; week <= plan.durationWeeks; week++) {
    const order = rotation[(week - 1) % rotation.length];
    days.forEach((day, i) => {
      list.push({ id: `w${week}-${DAY_NAMES[day]}`, week, day: DAY_NAMES[day], workout: order[i], date: addDays(monday, (week - 1) * 7 + day) });
    });
  }
  return list;
}

export const phaseOf = (plan, week) => plan.phases.find((p) => week >= p.fromWeek && week <= p.toWeek) ?? null;

export function roundsFor(plan, week, light = false) {
  if (light) return plan.lightRounds;
  return plan.roundsByWeek.find((r) => week >= r.fromWeek && week <= r.toWeek)?.rounds ?? plan.maxRounds;
}

// Blocos com número fixo de rodadas (ou pirâmide) não mudam com a semana nem ganham séries extras.
export const blockRounds = (plan, block, week, light) => block.rounds ?? roundsFor(plan, week, light);

export const workoutItems = (plan, workoutId) => plan.workouts[workoutId].blocks.flatMap((b) => b.items);

const ID = /^[A-Za-z0-9][\w-]{0,39}$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isWeekday = (v) => Number.isInteger(v) && v >= 0 && v <= 6;
const has = (o, k) => Object.hasOwn(o, k);

function checkVideo(video, where, fail) {
  if (video === undefined || video === null) return;
  // A URL vira link na tela: só https evita "javascript:" vindo de um arquivo importado.
  if (!isObj(video) || !isText(video.url) || !video.url.startsWith('https://')) fail(`${where}: o vídeo precisa de um link https`);
}

function checkList(list, where, fail) {
  if (!isObj(list) || !isText(list.title) || !Array.isArray(list.items)) fail(`${where} incompleto`);
  list.items.forEach((item) => {
    if (!isObj(item) || !isText(item.name)) fail(`${where}: item sem nome`);
    checkVideo(item.video, where, fail);
  });
}

export function validatePlan(p) {
  const fail = (msg) => { throw new Error(`Plano inválido: ${msg}`); };
  if (!isObj(p)) fail('o arquivo não contém um plano');
  if (p.schemaVersion !== 1) fail('versão de formato não suportada');
  if (typeof p.id !== 'string' || !ID.test(p.id)) fail('id ausente ou com caracteres inválidos');
  if (!isText(p.name)) fail('nome ausente');
  if (!Number.isInteger(p.durationWeeks) || p.durationWeeks < 1 || p.durationWeeks > 104) fail('duração deve ter de 1 a 104 semanas');
  if (!Number.isInteger(p.maxRounds) || p.maxRounds < 1) fail('maxRounds inválido');
  if (!Number.isInteger(p.lightRounds) || p.lightRounds < 1) fail('lightRounds inválido');
  if (!Array.isArray(p.reviewWeeks)) fail('reviewWeeks ausente');
  if (!Array.isArray(p.roundsByWeek) || !p.roundsByWeek.length) fail('roundsByWeek ausente');
  if (!Array.isArray(p.phases) || !p.phases.every((f) => isObj(f) && isText(f.name))) fail('fases inválidas');
  if (!Array.isArray(p.bandLevels)) fail('bandLevels ausente');
  if (!Array.isArray(p.dailyTasks) || !p.dailyTasks.every((t) => isObj(t) && ID.test(t.id ?? '') && isText(t.label) && Array.isArray(t.days))) fail('dailyTasks inválido');
  checkList(p.warmup, 'aquecimento', fail);
  checkList(p.mobility, 'mobilidade', fail);
  if (!isObj(p.safety)) fail('orientações de segurança ausentes');
  if (p.painLabel !== undefined && !(isText(p.painLabel) && p.painLabel.length <= 40)) fail('painLabel deve ser um texto de até 40 caracteres');

  if (!isObj(p.exercises)) fail('exercícios ausentes');
  for (const [id, ex] of Object.entries(p.exercises)) {
    if (!ID.test(id)) fail(`id de exercício inválido: ${id}`);
    if (!isObj(ex) || !isText(ex.name) || !isText(ex.target) || !isText(ex.unit)) fail(`exercício ${id} incompleto`);
    if (!(ex.min > 0) || !(ex.max >= ex.min)) fail(`exercício ${id}: faixa inválida`);
    checkVideo(ex.video, `exercício ${id}`, fail);
  }

  if (!isObj(p.workouts) || !Object.keys(p.workouts).length) fail('treinos ausentes');
  for (const [id, w] of Object.entries(p.workouts)) {
    if (!ID.test(id)) fail(`id de treino inválido: ${id}`);
    if (!isObj(w) || !isText(w.title) || !Array.isArray(w.blocks) || !w.blocks.length) fail(`treino ${id} incompleto`);
    if (w.estimatedMinutes !== undefined && !(Number.isInteger(w.estimatedMinutes) && w.estimatedMinutes > 0)) fail(`treino ${id}: duração estimada inválida`);
    for (const b of w.blocks) {
      if (!isObj(b) || !['sets', 'pyramid'].includes(b.type) || !Array.isArray(b.items) || !b.items.length) fail(`treino ${id}: bloco inválido`);
      for (const item of b.items) if (!has(p.exercises, item)) fail(`treino ${id} cita o exercício inexistente ${item}`);
    }
  }

  const s = p.schedule;
  if (!isObj(s) || !Array.isArray(s.days) || !s.days.length || !s.days.every(isWeekday)) fail('dias da semana inválidos');
  if (new Set(s.days).size !== s.days.length) fail('dias da semana repetidos');
  if (!Array.isArray(s.rotation) || !s.rotation.length) fail('rotação ausente');
  for (const order of s.rotation) {
    if (!Array.isArray(order) || order.length !== s.days.length) fail('a rotação precisa ter um treino por dia');
    for (const w of order) if (!has(p.workouts, w)) fail(`a rotação cita o treino inexistente ${w}`);
  }
  return p;
}

export const parsePlan = (raw) => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Plano inválido: o arquivo não é um JSON');
  }
  return validatePlan(data);
};

/* ---------- Execução ---------- */

const FINISHED = ['feito', 'leve', 'pulado'];
export const isFinished = (rec) => FINISHED.includes(rec?.status);

export const sessionOn = (schedule, date) => schedule.find((s) => s.date === date) ?? null;

export const nextSession = (schedule, sessions, today) =>
  schedule.find((s) => s.date >= today && !isFinished(sessions[s.id])) ?? null;

export const overdueSessions = (schedule, sessions, today) =>
  schedule.filter((s) => s.date < today && !isFinished(sessions[s.id]));

export function adherence(schedule, sessions, today) {
  const due = schedule.filter((s) => s.date <= today);
  const count = (status) => due.filter((s) => sessions[s.id]?.status === status).length;
  const done = count('feito');
  const light = count('leve');
  return { due: due.length, done, light, skipped: count('pulado'), pct: due.length ? Math.round(((done + light) / due.length) * 100) : null };
}

export function readyToProgress(exercise, log, count) {
  const sets = log?.sets ?? [];
  if (count < 1) return false;
  for (let i = 0; i < count; i++) {
    if (!sets[i]?.done || !(Number(sets[i].value) >= exercise.max)) return false;
  }
  return true;
}

// Melhor série concluída de um exercício numa semana. Valor 0 indica pirâmide concluída.
export function bestInWeek(schedule, sessions, exerciseId, week) {
  let best = null;
  for (const s of schedule) {
    if (s.week !== week) continue;
    const log = sessions[s.id]?.exercises?.[exerciseId];
    for (const set of log?.sets ?? []) {
      if (!set?.done) continue;
      const value = Number(set.value) || 0;
      if (!best || value > best.value) best = { value, band: log.band || '' };
    }
  }
  return best;
}

// Séries de um exercício; as extras herdadas nunca passam do limite do plano.
export function setCount(plan, block, week, light, extra = 0) {
  const base = blockRounds(plan, block, week, light);
  return block.rounds ? base : Math.min(plan.maxRounds, base + extra);
}

/* ---------- Medidas ---------- */

const byDate = (a, b) => a.date.localeCompare(b.date);

export function ageAt(birthDate, date) {
  if (!birthDate) return null;
  const birth = fromISO(birthDate);
  const on = fromISO(date);
  const beforeBirthday = on.getMonth() < birth.getMonth() || (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());
  return on.getFullYear() - birth.getFullYear() - (beforeBirthday ? 1 : 0);
}

export const bmi = (weight, heightCm) => (weight > 0 && heightCm > 0 ? weight / (heightCm / 100) ** 2 : null);
export const musclePct = (m) => (m?.muscle > 0 && m?.weight > 0 ? (m.muscle / m.weight) * 100 : null);

// Ritmo entre a última pesagem e a anterior com pelo menos 7 dias de distância.
export function weightRate(measurements) {
  const sorted = measurements.filter((m) => m.weight > 0).sort(byDate);
  const last = sorted.at(-1);
  if (!last) return null;
  const prev = sorted.filter((m) => diffDays(m.date, last.date) >= 7).at(-1);
  if (!prev) return null;
  const pct = ((prev.weight - last.weight) / prev.weight) * 100 / (diffDays(prev.date, last.date) / 7);
  return { pct, level: pct > 1 ? 'rapido' : pct >= 0.5 ? 'ideal' : 'lento' };
}

// Compara a primeira e a última medição que têm o campo preenchido.
export function changeOf(measurements, read) {
  const valid = measurements.filter((m) => read(m) > 0).sort(byDate);
  if (!valid.length) return null;
  const first = read(valid[0]);
  const last = read(valid.at(-1));
  return { first, last, delta: last - first };
}

export const proteinRange = (targetKg) => (targetKg > 0 ? [Math.round(targetKg * 1.2), Math.round(targetKg * 1.6)] : null);

// Os efeitos gastrointestinais concentram-se no aumento de dose.
export function doseRaisedRecently(injections, today, days = 7) {
  const sorted = injections.filter((i) => i.date <= today).sort(byDate);
  for (let i = sorted.length - 1; i >= 1; i--) {
    if (sorted[i].dose > sorted[i - 1].dose) return diffDays(sorted[i].date, today) < days;
  }
  return false;
}

export const upsertByDate = (list, entry) => [...list.filter((e) => e.date !== entry.date), entry].sort(byDate);

// Mescla campos na medição do dia; uma pesagem rápida não apaga a bioimpedância da mesma data.
export function mergeMeasurement(list, entry) {
  const current = list.find((m) => m.date === entry.date);
  const filled = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null && v !== ''));
  return upsertByDate(list, { ...current, ...filled });
}

/* ---------- Estado e backup ---------- */

export const emptyState = () => ({
  version: 2,
  profile: { name: '', sex: '', birthDate: '', height: null, targetWeight: null, conditions: '' },
  activePlanId: '',
  plans: {},
  planStarts: {},
  sessions: {},
  daily: {},
  measurements: [],
  injections: [],
  choices: {},
  lastBackup: null,
  drafts: {},
});

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dated = (v) => Array.isArray(v) && v.every((e) => isObj(e) && isDate(e.date));

// Copia só os campos conhecidos: um backup é dado externo e não pode acrescentar nada ao estado.
export function parseBackup(raw) {
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    throw new Error('Arquivo de backup inválido');
  }
  const valid = isObj(o) && o.version === 2 && isObj(o.profile) && isObj(o.plans) && isObj(o.planStarts) &&
    isObj(o.sessions) && isObj(o.daily) && dated(o.measurements) && dated(o.injections);
  if (!valid) throw new Error('Arquivo de backup inválido');
  Object.values(o.plans).forEach(validatePlan);
  if (o.activePlanId && !has(o.plans, o.activePlanId)) throw new Error('Arquivo de backup inválido');
  const base = emptyState();
  return {
    ...base,
    profile: { ...base.profile, ...o.profile },
    activePlanId: o.activePlanId || '',
    plans: o.plans,
    planStarts: o.planStarts,
    sessions: o.sessions,
    daily: o.daily,
    measurements: o.measurements,
    injections: o.injections,
    choices: isObj(o.choices) ? o.choices : {},
    lastBackup: isObj(o.lastBackup) && typeof o.lastBackup.file === 'string' && typeof o.lastBackup.at === 'string' ? o.lastBackup : null,
    drafts: cleanDrafts(o.drafts),
  };
}

/* ---------- Registros do banco de dados ---------- */

const META_KEYS = ['version', 'profile', 'activePlanId', 'planStarts', 'choices', 'lastBackup'];

// Cada treino, medição, dia, aplicação e plano vira um registro, para gravar só o que mudou.
export function toRecords(state) {
  const records = META_KEYS.map((key) => ({ store: 'meta', key, value: state[key] }));
  for (const [id, plan] of Object.entries(state.plans)) records.push({ store: 'plans', key: id, value: plan });
  for (const [planId, list] of Object.entries(state.sessions)) {
    for (const [id, rec] of Object.entries(list)) records.push({ store: 'sessions', key: `${planId}/${id}`, value: rec });
  }
  for (const m of state.measurements) records.push({ store: 'measurements', key: m.date, value: m });
  for (const i of state.injections) records.push({ store: 'injections', key: i.date, value: i });
  for (const [date, day] of Object.entries(state.daily)) records.push({ store: 'daily', key: date, value: day });
  for (const [id, draft] of Object.entries(state.drafts ?? {})) records.push({ store: 'drafts', key: id, value: draft });
  return records.filter((r) => r.value !== undefined);
}

export function fromRecords(records) {
  const state = emptyState();
  for (const { store, key, value } of records) {
    if (store === 'meta' && META_KEYS.includes(key)) state[key] = value;
    else if (store === 'plans') state.plans[key] = value;
    else if (store === 'sessions') {
      const cut = key.indexOf('/');
      (state.sessions[key.slice(0, cut)] ??= {})[key.slice(cut + 1)] = value;
    } else if (store === 'measurements') state.measurements.push(value);
    else if (store === 'injections') state.injections.push(value);
    else if (store === 'daily') state.daily[key] = value;
    else if (store === 'drafts') state.drafts[key] = value;
  }
  state.measurements.sort(byDate);
  state.injections.sort(byDate);
  return state;
}

// Operações para levar o banco de "prev" a "next": grava o que mudou e apaga o que sumiu.
export function diffRecords(prev, next) {
  const id = (r) => `${r.store}\u0000${r.key}`;
  const before = new Map(prev.map((r) => [id(r), JSON.stringify(r.value)]));
  const after = new Set();
  const ops = [];
  for (const r of next) {
    after.add(id(r));
    const json = JSON.stringify(r.value);
    if (before.get(id(r)) !== json) ops.push({ store: r.store, key: r.key, value: JSON.parse(json) });
  }
  for (const r of prev) if (!after.has(id(r))) ops.push({ store: r.store, key: r.key, delete: true });
  return ops;
}

/* ---------- Editor de planos ---------- */

// No editor, exercícios e treinos são listas com "id", para poder renomear, e todo campo existe,
// mesmo vazio, para a tela não precisar testar cada um. planFromDraft volta ao formato do plano.
const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (isObj(v) ? v : {});
const numOr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : '');
const strs = (v) => arr(v).map(str);
const draftVideo = (v) => ({ label: str(obj(v).label), url: str(obj(v).url) });
const draftList = (l, title) => ({
  title: str(obj(l).title ?? title),
  note: str(obj(l).note),
  items: arr(obj(l).items).map((i) => ({ name: str(obj(i).name), dose: str(obj(i).dose), video: draftVideo(obj(i).video) })),
});

export function normalizeDraft(input) {
  const m = obj(input);
  const s = obj(m.schedule);
  const g = obj(m.guidance);
  const safety = obj(m.safety);
  return {
    id: str(m.id), name: str(m.name), version: str(m.version), description: str(m.description), painLabel: str(m.painLabel),
    durationWeeks: numOr(m.durationWeeks), maxRounds: numOr(m.maxRounds), lightRounds: numOr(m.lightRounds),
    reviewWeeks: arr(m.reviewWeeks).filter(Number.isInteger),
    schedule: { days: arr(s.days).filter(isWeekday), rotation: arr(s.rotation).map(strs) },
    roundsByWeek: arr(m.roundsByWeek).map(obj).map((r) => ({ fromWeek: numOr(r.fromWeek), toWeek: numOr(r.toWeek), rounds: numOr(r.rounds) })),
    phases: arr(m.phases).map(obj).map((f) => ({ name: str(f.name), fromWeek: numOr(f.fromWeek), toWeek: numOr(f.toWeek), focus: str(f.focus) })),
    guidance: { effort: str(g.effort), progression: str(g.progression), videos: str(g.videos) },
    dailyTasks: arr(m.dailyTasks).map(obj).map((t) => ({ id: str(t.id), label: str(t.label), days: arr(t.days).filter(isWeekday), list: str(t.list), icon: str(t.icon) })),
    warmup: draftList(m.warmup, 'Aquecimento'),
    mobility: draftList(m.mobility, 'Mobilidade'),
    bandLevels: strs(m.bandLevels),
    exercises: arr(m.exercises).map(obj).map((e) => ({
      id: str(e.id), name: str(e.name), target: str(e.target), min: numOr(e.min), max: numOr(e.max), unit: str(e.unit) || 'reps',
      load: str(e.load), band: e.band === true, how: str(e.how), video: draftVideo(e.video),
    })),
    workouts: arr(m.workouts).map(obj).map((w) => ({
      id: str(w.id), title: str(w.title), estimatedMinutes: numOr(w.estimatedMinutes),
      blocks: arr(w.blocks).map(obj).map((b) => ({
        type: b.type === 'pyramid' ? 'pyramid' : 'sets', label: str(b.label), rounds: numOr(b.rounds), restSeconds: numOr(b.restSeconds),
        instructions: str(b.instructions), items: strs(b.items),
      })),
    })),
    safety: {
      emergencyTitle: str(safety.emergencyTitle), emergency: strs(safety.emergency), stop: strs(safety.stop),
      avoid: strs(safety.avoid), always: strs(safety.always),
    },
  };
}

export const draftFromPlan = (plan) => normalizeDraft({
  ...plan,
  exercises: Object.entries(plan.exercises).map(([id, ex]) => ({ ...ex, id })),
  workouts: Object.entries(plan.workouts).map(([id, w]) => ({ ...w, id })),
});

// Ponto de partida de um plano novo: já é válido, com um treino e um exercício.
export const blankDraft = () => normalizeDraft({
  id: 'novo-plano', name: 'Novo plano', version: '1', durationWeeks: 12, maxRounds: 3, lightRounds: 2, reviewWeeks: [1, 4, 8, 12],
  schedule: { days: [0, 2, 4], rotation: [['A', 'A', 'A']] },
  roundsByWeek: [{ fromWeek: 1, toWeek: 12, rounds: 3 }],
  phases: [{ name: 'Fase 1', fromWeek: 1, toWeek: 12, focus: '' }],
  bandLevels: ['Sem elástico', 'Leve', 'Médio', 'Forte'],
  exercises: [{ id: 'A1', name: 'Exercício 1', target: '10–12', min: 10, max: 12, unit: 'reps' }],
  workouts: [{ id: 'A', title: 'Treino A', blocks: [{ type: 'sets', label: 'Bloco 1', restSeconds: 60, items: ['A1'] }] }],
});

const keyedById = (list, what) => {
  const out = {};
  for (const item of list) {
    const id = item.id.trim();
    if (!id) throw new Error(`Plano inválido: ${what} sem id`);
    if (has(out, id)) throw new Error(`Plano inválido: ${what} com id repetido: ${id}`);
    const { id: _, ...rest } = item;
    out[id] = rest;
  }
  return out;
};

// Converte o rascunho em plano, sem campos opcionais vazios. Não valida: use validatePlan depois.
export function planFromDraft(input) {
  const d = normalizeDraft(input);
  const t = (v) => v.trim();
  const lines = (v) => v.map(t).filter(Boolean);
  const put = (o, k, v) => { if (v !== '') o[k] = v; return o; };
  const video = (v) => (t(v.url) ? put({ url: t(v.url) }, 'label', t(v.label)) : undefined);
  const list = (l) => put({
    title: t(l.title),
    items: l.items.map((i) => {
      const item = put(put({ name: t(i.name) }, 'dose', t(i.dose)), 'video', video(i.video) ?? '');
      return item;
    }),
  }, 'note', t(l.note));
  const guidance = {};
  for (const k of ['effort', 'progression', 'videos']) put(guidance, k, t(d.guidance[k]));
  const plan = {
    schemaVersion: 1, id: t(d.id), name: t(d.name), version: t(d.version), description: t(d.description),
    durationWeeks: d.durationWeeks, maxRounds: d.maxRounds, lightRounds: d.lightRounds, reviewWeeks: d.reviewWeeks,
    schedule: { days: [...d.schedule.days].sort((a, b) => a - b), rotation: d.schedule.rotation.map((r) => r.map(t).filter(Boolean)) },
    roundsByWeek: d.roundsByWeek, phases: d.phases.map((f) => put({ name: t(f.name), fromWeek: f.fromWeek, toWeek: f.toWeek }, 'focus', t(f.focus))),
    guidance,
  };
  put(plan, 'painLabel', t(d.painLabel));
  Object.assign(plan, {
    dailyTasks: d.dailyTasks.map((x) => put(put({ id: t(x.id), label: t(x.label), days: [...x.days].sort((a, b) => a - b) }, 'list', x.list), 'icon', x.icon)),
    warmup: list(d.warmup),
    mobility: list(d.mobility),
    bandLevels: lines(d.bandLevels),
    exercises: keyedById(d.exercises.map((e) => put({
      id: e.id, name: t(e.name), target: t(e.target), min: e.min, max: e.max, unit: e.unit, load: t(e.load), band: e.band, how: t(e.how),
    }, 'video', video(e.video) ?? '')), 'exercício'),
    workouts: keyedById(d.workouts.map((w) => put({
      id: w.id, title: t(w.title),
      blocks: w.blocks.map((b) => {
        const block = put(put(put({ type: b.type }, 'label', t(b.label)), 'rounds', b.rounds), 'restSeconds', b.restSeconds);
        return Object.assign(put(block, 'instructions', t(b.instructions)), { items: b.items.map(t).filter(Boolean) });
      }),
    }, 'estimatedMinutes', w.estimatedMinutes)), 'treino'),
    safety: put({ emergency: lines(d.safety.emergency), stop: lines(d.safety.stop), avoid: lines(d.safety.avoid), always: lines(d.safety.always) },
      'emergencyTitle', t(d.safety.emergencyTitle)),
  });
  return plan;
}

// null quando o rascunho já é um plano válido; senão, o primeiro problema encontrado.
export function draftProblem(draft) {
  try {
    validatePlan(planFromDraft(draft));
    return null;
  } catch (e) {
    return e.message.replace(/^Plano inválido: /, '');
  }
}

// Ao renomear um exercício ou treino, atualiza quem o cita.
export function renameInDraft(draft, kind, from, to) {
  if (!from || from === to) return;
  if (kind === 'exercise') {
    for (const w of draft.workouts) for (const b of w.blocks) b.items = b.items.map((i) => (i === from ? to : i));
  } else if (kind === 'workout') {
    draft.schedule.rotation = draft.schedule.rotation.map((r) => r.map((w) => (w === from ? to : w)));
  }
}

// Rascunhos vindos de um backup: só objetos com id válido; o conteúdo é normalizado.
function cleanDrafts(raw) {
  const out = {};
  for (const [id, d] of Object.entries(obj(raw))) {
    if (ID.test(id) && isObj(d)) out[id] = { id, updatedAt: str(d.updatedAt), plan: normalizeDraft(d.plan) };
  }
  return out;
}
