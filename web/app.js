import { applyOps, openDb, readAll } from './db.js';
import { editorActions, editorImporters, editorView, initEditor } from './editor.js';
import { icon } from './icons.js';
import {
  adherence, ageAt, bestInWeek, blockRounds, bmi, buildSchedule, changeOf, diffRecords, doseRaisedRecently, emptyState, fromISO, fromRecords,
  isFinished, mergeMeasurement, mondayOf, musclePct, nextMonday, nextSession, overdueSessions, parseBackup, parsePlan,
  phaseOf, proteinRange, readyToProgress, sessionOn, setCount, toISO, toRecords, upsertByDate, weekdayIndex, weightRate, workoutItems,
} from './logic.js';

// Diário de gravação: cópia síncrona do estado até o IndexedDB confirmar. Usa a mesma chave do
// armazenamento antigo, então dados de versões anteriores são migrados pelo mesmo caminho.
const JOURNAL_KEY = 'fitmonjaro.v2';
const STATUS = {
  feito: { label: 'Feito', icon: 'check' },
  leve: { label: 'Leve', icon: 'half' },
  pulado: { label: 'Pulado', icon: 'skip' },
};
const NOTE_CHIPS = ['Cansaço', 'Náusea', 'Elástico fácil', 'Elástico difícil', 'Técnica difícil'];
// Formulários que, ao salvar, geram uma cópia de segurança em Downloads.
const BACKUP_FORMS = new Set(['setup', 'profile', 'measurement', 'quick-weight', 'injection']);

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const toastEl = document.getElementById('toast');
const restEl = document.getElementById('rest');
const updateEl = document.getElementById('update');
const UPDATE_INTERVAL = 15 * 60 * 1000;

let state = emptyState();
let setupPlan = null; // Plano escolhido na configuração inicial, antes de salvar o perfil.
let loadError = false;
let db = null;
let confirmed = []; // Registros já gravados no banco.
let queued = []; // Registros já enviados ao banco, gravados ou não.
let pending = 0;
let restEnd = 0;
let restTimer = null;
let wakeLock = null;
let swReg = null;
let lastUpdateCheck = 0;
let updateRequested = false;
let appVersion = '';

const snapshot = (records) => JSON.parse(JSON.stringify(records));

function markPending() {
  document.documentElement.dataset.pending = String(pending);
}

// Grava só os registros que mudaram. A transação abre na hora do toque, para não se perder se o app
// for fechado logo depois; o IndexedDB executa as transações na ordem em que foram abertas.
function save() {
  if (!db) return;
  const next = snapshot(toRecords(state));
  const ops = diffRecords(queued, next);
  if (!ops.length) return;
  writeJournal();
  queued = next;
  pending++;
  markPending();
  applyOps(db, ops)
    .then(() => {
      confirmed = next;
      if (pending === 1) clearJournal(); // Era a última gravação pendente.
      const saved = document.getElementById('saved');
      if (saved && pending === 1) saved.innerHTML = `${icon('check')} Salvo às ${hhmm(new Date())}`;
    })
    .catch(() => {
      queued = confirmed; // A próxima gravação reenvia tudo o que faltou.
      toast('Não foi possível salvar no aparelho.');
    })
    .finally(() => {
      pending--;
      markPending();
    });
}

// Gravação síncrona: sobrevive mesmo se o app for fechado antes do IndexedDB terminar.
function writeJournal() {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(state));
  } catch {
    // Sem diário desta vez; a gravação no banco segue normalmente.
  }
}

function clearJournal() {
  try {
    localStorage.removeItem(JOURNAL_KEY);
  } catch {
    // Nada a fazer: o diário será reaplicado, sem efeito, na próxima abertura.
  }
}

function readJournal() {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    return raw ? parseBackup(raw) : null;
  } catch {
    return null;
  }
}

async function loadState() {
  try {
    db = await openDb();
  } catch {
    toast('O armazenamento do navegador está indisponível: os dados não serão guardados.');
    return emptyState();
  }
  const records = await readAll(db);
  confirmed = records;
  queued = records;
  // Um diário presente é o estado mais recente que não chegou a ser confirmado no banco.
  const journal = readJournal();
  if (journal) {
    const next = snapshot(toRecords(journal));
    await applyOps(db, diffRecords(records, next));
    confirmed = next;
    queued = next;
    clearJournal(); // Só depois de confirmada a gravação no banco.
    return journal;
  }
  return records.length ? parseBackup(JSON.stringify(fromRecords(records))) : emptyState();
}

const today = () => toISO(new Date());
const plan = () => state.plans[state.activePlanId] ?? null;
const startDate = () => state.planStarts[state.activePlanId];
const schedule = () => buildSchedule(plan(), startDate());
const sessions = () => (state.sessions[state.activePlanId] ??= {});
const exerciseOf = (id) => plan().exercises[id];
const choicesOf = () => (state.choices[state.activePlanId] ??= {});

// Guarda a última escolha de cada exercício para preencher os próximos treinos.
function remember(exId, values) {
  const choices = choicesOf();
  choices[exId] = { ...choices[exId], ...values };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => fromISO(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtFull = (iso) => fromISO(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtNum = (n, digits = 1) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: digits });
const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${fmtNum(n, digits)}`;
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

/* ---------- Peças visuais ---------- */

// Cada treino recebe sempre a mesma cor, pela ordem em que aparece no plano.
const workoutColor = (id) => `w${Math.max(0, Object.keys(plan().workouts).indexOf(id)) % 4}`;
const badge = (id, size = '') => `<span class="badge ${workoutColor(id)} ${size}">${esc(id)}</span>`;
const statusMark = (status) => `<span class="mark ${status}">${icon(STATUS[status].icon)}<span class="sr">${STATUS[status].label}</span></span>`;
const videoLink = (video) => (video ? `<a class="video" href="${esc(video.url)}" target="_blank" rel="noopener noreferrer">${icon('play')} Vídeo: ${esc(video.label ?? 'demonstração')}</a>` : '');

const stepList = (list) => `<ol class="steps">${list.items.map((item) => `
  <li><span>${esc(item.name)}${item.dose ? ` <span class="muted">· ${esc(item.dose)}</span>` : ''}</span>${item.video ? videoLink(item.video) : ''}</li>`).join('')}</ol>${list.note ? `<p class="muted">${esc(list.note)}</p>` : ''}`;

function safetyBox(p, open = false) {
  const s = p.safety;
  if (!s.emergency?.length && !s.stop?.length) return '';
  return `<details class="danger-box" ${open ? 'open' : ''}><summary>${icon('alert')} Quando parar</summary>
    ${s.emergency?.length ? `<p><strong>${esc(s.emergencyTitle ?? 'Emergência')}</strong></p><ul>${s.emergency.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${s.stop?.length ? `<ul>${s.stop.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

// Onde ficam os dados e como recuperar, mostrado ao concluir e no Perfil.
function dataInfo() {
  const last = state.lastBackup;
  const when = last ? `${fmtDate(toISO(new Date(last.at)))} às ${hhmm(new Date(last.at))}` : '';
  return `<ul class="info">
    <li>${icon('phone')}<span><strong>No app:</strong> tudo é salvo automaticamente neste aparelho, a cada registro.</span></li>
    <li>${icon('folder')}<span><strong>Cópia em Downloads:</strong> o app salva uma cópia sozinho ao concluir um treino ou salvar uma medição. Abra o app <strong>Arquivos</strong> › <strong>Downloads</strong>.${last ? ` Última: <strong>${esc(last.file)}</strong> (${when}).` : ''}</span></li>
    <li>${icon('chart')}<span><strong>Consultar:</strong> calendário e evolução em <strong>Treinos</strong>; peso e bioimpedância em <strong>Progresso</strong>.</span></li>
    <li>${icon('restore')}<span><strong>Recuperar</strong> (celular novo ou dados apagados): <strong>Perfil › Recuperar backup</strong> e escolha o arquivo mais recente.</span></li>
  </ul>`;
}

const importButton = (kind, label, cls = 'ghost') => `<label class="button ${cls}">${icon('restore')} ${label}<input type="file" data-import="${kind}" hidden></label>`;

/* ---------- Configuração inicial ---------- */

const profileFields = (p) => `
  <label>Nome <input name="name" required maxlength="80" autocomplete="name" value="${esc(p.name)}"></label>
  <div class="two">
    <label>Sexo
      <select name="sex" required>
        <option value="">Escolher</option>
        ${['Feminino', 'Masculino', 'Outro'].map((s) => `<option ${p.sex === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </label>
    <label>Nascimento <input type="date" name="birthDate" required max="${today()}" value="${esc(p.birthDate)}"></label>
  </div>
  <div class="two">
    <label>Altura (cm) <input type="number" name="height" step="0.5" min="80" max="250" inputmode="decimal" required value="${esc(p.height)}"></label>
    <label>Peso-alvo (kg) <input type="number" name="targetWeight" step="0.1" min="20" max="300" inputmode="decimal" value="${esc(p.targetWeight)}"></label>
  </div>
  <label>Condições de saúde (opcional) <textarea name="conditions" rows="2" maxlength="500">${esc(p.conditions)}</textarea></label>`;

function setupView() {
  const error = loadError ? `<p class="danger-box">${icon('alert')} Não foi possível ler os dados salvos neste aparelho. Recupere o backup mais recente da pasta Downloads.</p>` : '';
  if (!setupPlan) {
    return `
    <h1>Bem-vindo</h1>
    ${error}
    <p class="muted">Seus dados ficam só neste aparelho. Antes de começar, peça liberação ao médico ou ao profissional que acompanha você.</p>
    <section class="card stack">
      <h2>${icon('plan')} Escolha o plano</h2>
      <p class="muted">Selecione o arquivo <b>.json</b> do seu plano de treino, recebido do profissional ou enviado para este aparelho.</p>
      ${importButton('setup-plan', 'Escolher arquivo do plano', 'primary')}
    </section>
    ${importButton('backup', 'Já tenho um backup')}
    <a class="button ghost" href="#/editor">${icon('plan')} Criar ou editar planos</a>`;
  }
  return `
    <h1>Bem-vindo</h1>
    ${error}
    <p class="muted">${icon('check')} Plano: <b>${esc(setupPlan.name)}</b> · <button type="button" class="link" data-a="setup-change-plan">trocar</button></p>
    <form data-form="setup" class="card stack">
      ${profileFields(state.profile)}
      <div class="two">
        <label>Peso atual (kg) <input type="number" name="weight" step="0.1" min="20" max="300" inputmode="decimal" required></label>
        <label>Início do plano <input type="date" name="startDate" required value="${nextMonday(today())}"></label>
      </div>
      <button class="primary">Começar</button>
    </form>`;
}

/* ---------- Hoje ---------- */

function outline(session) {
  const p = plan();
  const rec = sessions()[session.id] ?? {};
  return `<ol class="outline">${p.workouts[session.workout].blocks.map((block) => {
    const rounds = blockRounds(p, block, session.week, rec.light);
    return block.items.map((id) => {
      const ex = exerciseOf(id);
      return `<li>${esc(ex.name)} <span class="muted">${block.type === 'pyramid' ? '5‑3‑1' : `${rounds} × ${esc(ex.target)}`}</span></li>`;
    }).join('');
  }).join('')}</ol>`;
}

function trainingCard(t) {
  const p = plan();
  const sch = schedule();
  const session = sessionOn(sch, t);
  const rec = session && sessions()[session.id];

  if (session && isFinished(rec)) {
    return `<a class="card hero row-card" href="#/sessao/${session.id}">
      ${statusMark(rec.status)}
      <span><strong>Treino de hoje registrado</strong><br><span class="muted">${badge(session.workout, 'sm')} ${esc(p.workouts[session.workout].title)} · ${STATUS[rec.status].label}</span></span>
    </a>`;
  }
  if (session) {
    const w = p.workouts[session.workout];
    const count = workoutItems(p, session.workout).length;
    return `<section class="card hero">
      <div class="hero-head">${badge(session.workout, 'lg')}
        <div><p class="eyebrow">Treino de hoje</p><h2>${esc(w.title)}</h2>
        <p class="muted">${count} exercícios${w.estimatedMinutes ? ` · ≈ ${w.estimatedMinutes} min` : ''} · semana ${session.week}/${p.durationWeeks}</p></div>
      </div>
      <a class="button primary" href="#/sessao/${session.id}">${icon('strength')} Começar treino</a>
      <div class="quick">
        <button class="ghost" data-a="quick" data-s="${session.id}" data-status="feito">${icon('check')}<span>Fiz tudo</span></button>
        <button class="ghost" data-a="quick" data-s="${session.id}" data-status="leve">${icon('half')}<span>Fiz leve</span></button>
        <button class="ghost" data-a="quick" data-s="${session.id}" data-status="pulado">${icon('skip')}<span>Pulei</span></button>
      </div>
      <details><summary>Ver exercícios</summary>${outline(session)}</details>
    </section>`;
  }
  const next = nextSession(sch, sessions(), t);
  if (next) {
    return `<a class="card hero row-card rest" href="#/sessao/${next.id}">
      ${icon('rest', 'big')}
      <span><strong>Hoje sem treino de força</strong><br><span class="muted">Próximo: ${next.day} ${fmtDate(next.date)} · ${badge(next.workout, 'sm')} ${esc(p.workouts[next.workout].title)}</span></span>
    </a>`;
  }
  return `<section class="card hero"><h2>Plano concluído</h2><p class="muted">Converse com a equipe de saúde sobre o próximo ciclo.</p></section>`;
}

const TASK_ICONS = { walk: 'walk', mobility: 'mobility' };

function routineTiles(t) {
  const p = plan();
  const day = state.daily[t] ?? {};
  const i = weekdayIndex(t);
  const range = proteinRange(state.profile.targetWeight);
  const tasks = p.dailyTasks.filter((task) => task.days.includes(i));
  const toggle = (field, label, iconName, cls) => `
    <button type="button" class="tile ${cls} ${day[field] ? 'on' : ''}" data-a="toggle-daily" data-field="${esc(field)}" aria-pressed="${day[field] ? 'true' : 'false'}">
      ${icon(iconName)}<span>${esc(label)}</span>${day[field] ? icon('check', 'tick') : ''}
    </button>`;
  const protein = Number(day.protein) || 0;
  const mobilityList = tasks.find((task) => task.list && p[task.list]);
  return `
    <h2 class="section">Rotina de hoje</h2>
    <div class="tiles">
      ${tasks.map((task) => toggle(task.id, task.label, task.icon ?? TASK_ICONS[task.id] ?? 'check', `c-${task.icon ?? TASK_ICONS[task.id] ?? 'walk'}`)).join('')}
      ${toggle('water', 'Hidratação', 'water', 'c-water')}
      <label class="tile c-protein ${range && protein >= range[0] ? 'on' : ''}">
        ${icon('protein')}<span>Proteína${range ? ` <small>${range[0]}–${range[1]} g</small>` : ''}</span>
        <input type="number" min="0" max="400" inputmode="numeric" placeholder="g" aria-label="Proteína hoje em gramas" data-f="daily" data-field="protein" value="${esc(day.protein)}">
      </label>
      <form class="tile c-weight" data-form="quick-weight">
        ${icon('weight')}<span>Peso</span>
        <span class="tile-input">
          <input type="number" name="weight" step="0.1" min="20" max="300" inputmode="decimal" required placeholder="kg" aria-label="Peso de hoje em kg" value="${esc(state.measurements.find((m) => m.date === t)?.weight)}">
          <button class="icon-btn" aria-label="Salvar peso">${icon('save')}</button>
        </span>
      </form>
    </div>
    ${mobilityList ? `<details class="card"><summary>${icon('mobility')} ${esc(p[mobilityList.list].title)}</summary>${stepList(p[mobilityList.list])}</details>` : ''}`;
}

function homeView() {
  const t = today();
  const overdue = overdueSessions(schedule(), sessions(), t);
  return `
    <p class="eyebrow">${esc(fmtFull(t))}</p>
    <h1>Olá, ${esc(state.profile.name.split(' ')[0])}</h1>
    ${doseRaisedRecently(state.injections, t) ? `<p class="pill-note c-med">${icon('med')} Semana de aumento de dose: use a versão leve se precisar.</p>` : ''}
    ${trainingCard(t)}
    ${overdue.length ? `<a class="pill-note" href="#/treinos">${icon('calendar')} ${overdue.length} treino(s) sem registro</a>` : ''}
    ${routineTiles(t)}`;
}

/* ---------- Treino ---------- */

function setRow(session, ex, log, i, count, suggestion, last) {
  const set = log.sets?.[i] ?? {};
  const common = `data-s="${session.id}" data-ex="${esc(ex.key)}" data-i="${i}" data-count="${count}" data-last="${last ? 1 : 0}" data-rest="${ex.rest}"`;
  return `
    <div class="set ${set.done ? 'done' : ''}">
      <span class="set-n" aria-hidden="true">${i + 1}</span>
      <button type="button" class="step" aria-label="Diminuir" data-a="step" data-delta="-1">−</button>
      <input type="number" min="0" max="999" inputmode="numeric" aria-label="${esc(ex.unit)} da série ${i + 1}"
        placeholder="${esc(suggestion)}" data-f="set" ${common} value="${esc(set.value)}">
      <button type="button" class="step" aria-label="Aumentar" data-a="step" data-delta="1">+</button>
      <input type="checkbox" aria-label="Série ${i + 1} concluída" data-f="setdone" ${common} ${set.done ? 'checked' : ''}>
    </div>`;
}

function exerciseCard(session, rec, block, id, isLastInBlock) {
  const p = plan();
  const ex = { ...exerciseOf(id), key: id, rest: block.restSeconds ?? 0 };
  const log = rec.exercises?.[id] ?? {};
  const previous = choicesOf()[id];
  const how = `<details class="how"><summary>${icon('play')} Como fazer</summary><p>${esc(ex.how)}</p>${videoLink(ex.video)}</details>`;

  if (block.type === 'pyramid') {
    return `<section class="card ex">
      <div class="ex-head"><span class="ex-id">${esc(id)}</span><h3>${esc(ex.name)}</h3></div>
      <p class="target">${esc(ex.target)}</p>
      ${how}
      <label class="check big-check"><input type="checkbox" data-f="pyramid" data-s="${session.id}" data-ex="${esc(id)}" ${log.sets?.[0]?.done ? 'checked' : ''}> Pirâmide concluída</label>
    </section>`;
  }

  const inherited = rec.light ? 0 : previous?.extra ?? 0;
  const count = setCount(p, block, session.week, rec.light, log.extra ?? inherited);
  const band = log.band || previous?.band || '';
  const rows = Array.from({ length: count }, (_, i) => setRow(session, ex, log, i, count, previous?.value ?? ex.min, isLastInBlock)).join('');
  return `<section class="card ex" data-card="${esc(id)}">
    <div class="ex-head"><span class="ex-id">${esc(id)}</span><h3>${esc(ex.name)}</h3></div>
    <p class="target"><strong>${count} × ${esc(ex.target)}</strong></p>
    ${ex.load ? `<p class="load">${icon('band')} ${esc(ex.load)}</p>` : ''}
    ${how}
    ${ex.band ? `<label class="band-row">${icon('band')} Elástico
      <select data-f="band" data-s="${session.id}" data-ex="${esc(id)}">
        <option value="">Escolher</option>
        ${p.bandLevels.map((b) => `<option ${band === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
      </select></label>` : ''}
    ${rows}
    <p class="ready" data-ready="${esc(id)}" ${readyToProgress(ex, log, count) ? '' : 'hidden'}>${icon('check')} Máximo atingido: aumente a dificuldade no próximo treino.</p>
    ${!block.rounds && count < p.maxRounds ? `<button type="button" class="ghost small" data-a="add-set" data-s="${session.id}" data-ex="${esc(id)}">${icon('plus')} série</button>` : ''}
  </section>`;
}

function blockSection(session, rec, block) {
  const p = plan();
  const rounds = blockRounds(p, block, session.week, rec.light);
  const pills = block.type === 'pyramid'
    ? `<span class="pill">5‑3‑1</span>`
    : `<span class="pill">${rounds} ${rounds === 1 ? 'rodada' : 'rodadas'}</span>${block.restSeconds ? `<span class="pill">${icon('timer')} ${block.restSeconds} s</span>` : ''}`;
  const hint = block.type === 'pyramid' ? block.instructions : block.items.length > 1 ? 'Um exercício logo depois do outro.' : '';
  return `<div class="block-head"><h2>${esc(block.label)}</h2>${pills}</div>
    ${hint ? `<p class="muted hint">${esc(hint)}</p>` : ''}
    ${block.items.map((id, i) => exerciseCard(session, rec, block, id, i === block.items.length - 1)).join('')}`;
}

function sessionView(id) {
  const p = plan();
  const session = schedule().find((s) => s.id === id);
  if (!session) return '<h1>Treino não encontrado</h1><a href="#/hoje">Voltar</a>';
  const rec = sessions()[id] ?? {};
  const w = p.workouts[session.workout];
  const phase = phaseOf(p, session.week);
  const notes = rec.notes ?? '';
  return `
    <a href="#/treinos" class="back">‹ Treinos</a>
    <div class="hero-head">${badge(session.workout, 'lg')}
      <div><h1>${esc(w.title)}</h1><p class="muted">Semana ${session.week} · ${session.day} ${fmtDate(session.date)}${phase ? ` · ${esc(phase.name)}` : ''}</p></div>
    </div>
    <p id="saved" class="saved" role="status">${icon('check')} ${isFinished(rec) ? `Registrado como ${STATUS[rec.status].label}` : 'Salvo automaticamente'}</p>
    ${safetyBox(p)}
    <label class="switch"><input type="checkbox" data-f="light" data-s="${id}" ${rec.light ? 'checked' : ''}> ${icon('half')} Versão leve</label>
    <details class="card"><summary>${icon('mobility')} ${esc(p.warmup.title)}</summary>${stepList(p.warmup)}</details>
    ${p.guidance?.effort ? `<p class="muted hint">${esc(p.guidance.effort)}</p>` : ''}
    ${w.blocks.map((block) => blockSection(session, rec, block)).join('')}
    <section class="card stack finish">
      <h2>Como foi?</h2>
      <label>${esc(painLabel(p))}: <output id="pain-out">${rec.pain ?? 0}</output>/10
        <input type="range" min="0" max="10" step="1" value="${rec.pain ?? 0}" data-f="pain" data-s="${id}">
      </label>
      <div class="chips-note">${[painLabel(p), ...NOTE_CHIPS].map((c) => `<button type="button" class="chip-btn" data-a="note-chip" data-s="${id}" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <details ${notes ? 'open' : ''}><summary>${icon('note')} Observação</summary>
        <textarea id="notes" rows="3" maxlength="1000" aria-label="Observações" data-f="notes" data-s="${id}">${esc(notes)}</textarea>
      </details>
      <button class="primary" data-a="finish" data-s="${id}" data-status="${rec.light ? 'leve' : 'feito'}">${icon('check')} Concluir treino</button>
      <button class="ghost small" data-a="finish" data-s="${id}" data-status="pulado">${icon('skip')} Pulei este treino</button>
    </section>`;
}

const painLabel = (p) => p.painLabel || 'Dor';

function doneView(id) {
  const p = plan();
  const session = schedule().find((s) => s.id === id);
  const rec = session && sessions()[id];
  if (!isFinished(rec)) return homeView();
  const setsDone = Object.values(rec.exercises ?? {}).reduce((n, log) => n + (log.sets ?? []).filter((s) => s?.done).length, 0);
  const summary = rec.status === 'pulado'
    ? 'Treino marcado como pulado.'
    : rec.quick && !setsDone
      ? `${STATUS[rec.status].label} · registro rápido.`
      : `${STATUS[rec.status].label} · ${setsDone} série(s) · ${painLabel(p).toLowerCase()} ${rec.pain ?? 0}/10`;
  return `
    <div class="done-hero">${statusMark(rec.status)}
      <h1>${rec.status === 'pulado' ? 'Registro salvo' : 'Treino concluído'}</h1>
      <p>${badge(session.workout, 'sm')} ${esc(p.workouts[session.workout].title)}</p>
      <p class="muted">${esc(summary)}</p>
    </div>
    <section class="card"><h2>Seus dados</h2>${dataInfo()}</section>
    <a class="button primary" href="#/hoje">Voltar para Hoje</a>`;
}

function sessionsView() {
  const p = plan();
  const sch = schedule();
  const t = today();
  let html = '';
  for (let week = 1; week <= p.durationWeeks; week++) {
    const phase = phaseOf(p, week);
    if (phase && phase.fromWeek === week) html += `<h2 class="section">${esc(phase.name)}</h2>`;
    const chips = sch.filter((s) => s.week === week).map((s) => {
      const rec = sessions()[s.id];
      const finished = isFinished(rec);
      const state_ = finished ? rec.status : s.date < t ? 'late' : s.date === t ? 'now' : '';
      const mark = finished ? statusMark(rec.status) : s.date < t ? '<span class="mark late">!<span class="sr">Sem registro</span></span>' : '';
      return `<a class="chip ${state_}" href="#/sessao/${s.id}">${badge(s.workout, 'sm')}<span class="chip-day"><strong>${s.day}</strong><small>${fmtDate(s.date)}</small></span>${mark}</a>`;
    }).join('');
    html += `<div class="week"><span class="wk">S${week}</span><div class="chips">${chips}</div></div>`;
  }
  const refs = p.reviewWeeks;
  const rows = Object.keys(p.exercises).map((id) => `
    <tr><th scope="row">${esc(id)}</th>${refs.map((w) => {
      const b = bestInWeek(sch, sessions(), id, w);
      if (!b) return '<td>–</td>';
      return `<td>${b.value || '✓'}${b.band ? `<small>${esc(b.band)}</small>` : ''}</td>`;
    }).join('')}</tr>`).join('');
  return `
    <h1>Treinos</h1>
    <p class="legend">${statusMark('feito')} feito ${statusMark('leve')} leve ${statusMark('pulado')} pulado</p>
    ${html}
    <details class="card"><summary>${icon('chart')} Evolução por exercício</summary>
      <p class="muted">Melhor série concluída nas semanas de referência.</p>
      <table><thead><tr><th scope="col">Ex.</th>${refs.map((w) => `<th scope="col">S${esc(w)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

/* ---------- Progresso ---------- */

const stat = (iconName, cls, label, value, detail = '') => `<div class="stat ${cls}">${icon(iconName)}<span class="muted">${esc(label)}</span><strong>${esc(value)}</strong><span class="muted">${esc(detail)}</span></div>`;
const changeStat = (iconName, cls, label, change, unit) => (change
  ? stat(iconName, cls, label, `${fmtNum(change.last)}${unit}`, `${signed(change.delta)}${unit} desde o início`)
  : stat(iconName, cls, label, '–'));

function entryList(list, kind, render) {
  if (!list.length) return '<p class="muted">Nenhum registro ainda.</p>';
  return `<ul class="entries">${[...list].reverse().map((e) => `
    <li><span>${render(e)}</span><button type="button" class="icon-btn" aria-label="Apagar registro de ${fmtDate(e.date)}" data-a="del-entry" data-kind="${kind}" data-date="${esc(e.date)}">${icon('trash')}</button></li>`).join('')}</ul>`;
}

function progressView() {
  const t = today();
  const { profile, measurements, injections } = state;
  const weight = changeOf(measurements, (m) => m.weight);
  const stats = adherence(schedule(), sessions(), t);
  const rate = weightRate(measurements);
  const age = ageAt(profile.birthDate, t);
  const currentBmi = weight ? bmi(weight.last, profile.height) : null;
  const facts = [
    currentBmi ? `IMC ${fmtNum(currentBmi)}` : '',
    age === null ? '' : `${age} anos`,
    weight && profile.targetWeight ? `faltam ${fmtNum(weight.last - profile.targetWeight)} kg para ${fmtNum(profile.targetWeight)} kg` : '',
    rate ? `ritmo ${fmtNum(rate.pct)}% por semana${rate.level === 'rapido' ? ' (acima de 1%: comente com a equipe)' : ''}` : '',
  ].filter(Boolean).join(' · ');
  const dateInput = `<label>Data <input type="date" name="date" required max="${t}" value="${t}"></label>`;
  const num = (name, label, step = '0.1', required = false) => `<label>${label} <input type="number" name="${name}" step="${step}" min="0" max="400" inputmode="decimal" ${required ? 'required' : ''}></label>`;
  const opt = (v, unit = '') => (v ? `${fmtNum(v)}${unit}` : '–');

  return `
    <h1>Progresso</h1>
    <section class="stats">
      ${changeStat('weight', 'c-weight', 'Peso', weight, ' kg')}
      ${changeStat('flame', 'c-protein', 'Massa de gordura', changeOf(measurements, (m) => m.fat), ' kg')}
      ${changeStat('strength', 'c-strength', 'Músculo % do peso', changeOf(measurements, musclePct), '%')}
      ${stat('calendar', 'c-walk', 'Treinos cumpridos', stats.pct === null ? '–' : `${stats.pct}%`, `${stats.done + stats.light} de ${stats.due}`)}
    </section>
    ${facts ? `<p class="muted facts">${esc(facts)}</p>` : ''}
    <details class="card"><summary>${icon('plus')} Nova medição</summary>
      <form data-form="measurement" class="stack">
        <div class="two">${dateInput}${num('weight', 'Peso (kg)', '0.1', true)}</div>
        <div class="two">${num('fat', 'Gordura (kg)')}${num('muscle', 'Músculo (kg)')}</div>
        ${num('visceral', 'Gordura visceral', '1')}
        <button class="primary">${icon('save')} Salvar medição</button>
      </form>
    </details>
    <section class="card"><h2>Histórico</h2>
      ${entryList(measurements, 'measurements', (m) => `<strong>${fmtDate(m.date)}</strong> · ${opt(m.weight, ' kg')}${m.visceral || m.fat || m.muscle ? `<br><span class="muted">visceral ${opt(m.visceral)} · gordura ${opt(m.fat, ' kg')} · músculo ${opt(m.muscle, ' kg')}${musclePct(m) ? ` (${fmtNum(musclePct(m))}%)` : ''}</span>` : ''}`)}
    </section>
    <details class="card c-med"><summary>${icon('med')} Aplicações de Mounjaro</summary>
      <p class="muted">Registro pessoal. A dose é definida pelo médico.</p>
      <form data-form="injection" class="stack"><div class="two">${dateInput}${num('dose', 'Dose (mg)', '0.5', true)}</div><button class="primary">${icon('save')} Salvar aplicação</button></form>
      ${entryList(injections, 'injections', (e) => `${fmtDate(e.date)} · ${fmtNum(e.dose)} mg`)}
    </details>`;
}

/* ---------- Plano ---------- */

function planView() {
  const p = plan();
  const s = p.safety;
  const list = (title, items) => (items?.length ? `<h3>${esc(title)}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
  const others = Object.values(state.plans).filter((x) => x.id !== p.id);
  return `
    <h1>${esc(p.name)}</h1>
    <p class="muted">Versão ${esc(p.version ?? '–')} · ${p.durationWeeks} semanas${p.description ? ` · ${esc(p.description)}` : ''}</p>
    <form data-form="plan-start" class="card inline">
      <label>Início do plano <input type="date" name="startDate" required value="${esc(startDate())}"></label>
      <button class="icon-btn" aria-label="Salvar início">${icon('save')}</button>
    </form>
    <p class="legend">${Object.entries(p.workouts).map(([id, w]) => `${badge(id, 'sm')} ${esc(w.title)}`).join(' &nbsp; ')}</p>
    ${p.guidance?.progression ? `<details class="card"><summary>${icon('chart')} Progressão</summary><p>${esc(p.guidance.progression)}</p></details>` : ''}
    <details class="card"><summary>${icon('alert')} Segurança</summary>
      ${s.emergency?.length ? `<div class="danger-box static"><p><strong>${esc(s.emergencyTitle ?? 'Emergência')}</strong></p><ul>${s.emergency.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${list('Pare o exercício', s.stop)}${list('Evitar', s.avoid)}${list('Sempre', s.always)}
    </details>
    <details class="card"><summary>${icon('plan')} Trocar ou alterar o plano</summary>
      <p class="muted">Monte ou altere planos no editor, ou importe um arquivo JSON. Um plano com o mesmo id substitui o anterior e mantém o histórico.</p>
      <a class="button primary" href="#/editor">${icon('plan')} Editor de planos</a>
      <button class="ghost" data-a="export-plan" data-plan="${esc(p.id)}">${icon('save')} Exportar este plano</button>
      ${importButton('plan', 'Importar plano')}
      ${others.length ? `<ul class="entries">${others.map((x) => `
        <li><span>${esc(x.name)}</span><span class="row">
          <button type="button" class="ghost small" data-a="use-plan" data-plan="${esc(x.id)}">Usar</button>
          <button type="button" class="icon-btn" aria-label="Apagar plano ${esc(x.name)}" data-a="del-plan" data-plan="${esc(x.id)}">${icon('trash')}</button>
        </span></li>`).join('')}</ul>` : ''}
    </details>`;
}

/* ---------- Perfil ---------- */

function settingsView() {
  const p = state.profile;
  const age = ageAt(p.birthDate, today());
  return `
    <h1>Perfil</h1>
    <section class="card row-card">${icon('user', 'big')}
      <span><strong>${esc(p.name)}</strong><br><span class="muted">${[p.sex, age === null ? '' : `${age} anos`, p.height ? `${fmtNum(p.height)} cm` : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
    </section>
    <details class="card"><summary>Editar perfil</summary>
      <form data-form="profile" class="stack">${profileFields(p)}<button class="primary">${icon('save')} Salvar perfil</button></form>
    </details>
    <section class="card"><h2>Seus dados</h2>${dataInfo()}${importButton('backup', 'Recuperar backup', 'primary')}</section>
    <section class="card stack"><h2>Aplicativo</h2>
      ${appVersion ? `<p class="muted">Versão ${esc(appVersion)}</p>` : ''}
      <button type="button" class="ghost" data-a="update-check">${icon('restore')} Verificar atualização</button>
    </section>
    <details class="card"><summary>${icon('trash')} Apagar dados</summary>
      <p class="muted">Remove tudo deste aparelho, inclusive os planos em elaboração. As cópias em Downloads continuam lá.</p>
      <button class="danger" data-a="wipe">Apagar todos os dados</button>
    </details>`;
}

/* ---------- Navegação ---------- */

function render({ keepScroll = false } = {}) {
  const [, route = 'hoje', raw = ''] = location.hash.split('/');
  let param = raw;
  try {
    param = decodeURIComponent(raw); // "Sáb" chega codificado no endereço.
  } catch {
    // Endereço malformado: segue com o texto original e cai em "não encontrado".
  }
  const ready = Boolean(plan());
  nav.hidden = !ready;
  const screens = { hoje: homeView, treinos: sessionsView, progresso: progressView, plano: planView, ajustes: settingsView };
  const pages = { ...screens, sessao: () => sessionView(param), concluido: () => doneView(param) };
  view.innerHTML = route === 'editor' ? editorView(param) : !ready ? setupView() : (pages[route] ?? homeView)();
  const active = route === 'sessao' ? 'treinos' : route === 'editor' ? 'plano' : screens[route] ? route : 'hoje';
  nav.querySelectorAll('a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${active}`));
  if (!keepScroll) window.scrollTo(0, 0);
  syncWakeLock(route === 'sessao');
}

async function syncWakeLock(want) {
  try {
    if (want && !wakeLock && document.visibilityState === 'visible' && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    wakeLock = null; // A tela apagar sozinha não impede o treino.
  }
}

/* ---------- Registro do treino ---------- */

function sessionRec(id) {
  sessions()[id] ??= { status: '', light: false, pain: 0, notes: '', exercises: {} };
  return sessions()[id];
}

function exerciseLog(id, exId) {
  const rec = sessionRec(id);
  rec.exercises ??= {};
  rec.exercises[exId] ??= { band: '', sets: [] }; // Sem "extra": até a pessoa mudar, vale a escolha anterior.
  return rec.exercises[exId];
}

function refreshReady(el) {
  const log = sessions()[el.dataset.s].exercises[el.dataset.ex];
  const target = view.querySelector(`[data-ready="${el.dataset.ex}"]`);
  if (target) target.hidden = !readyToProgress(exerciseOf(el.dataset.ex), log, Number(el.dataset.count));
}

function startRest(seconds) {
  restEnd = Date.now() + seconds * 1000;
  restEl.hidden = false;
  clearInterval(restTimer);
  restTimer = setInterval(tickRest, 250);
  tickRest();
}

function stopRest() {
  clearInterval(restTimer);
  restEl.hidden = true;
}

function tickRest() {
  const left = Math.ceil((restEnd - Date.now()) / 1000);
  if (left <= 0) {
    stopRest();
    navigator.vibrate?.([300, 150, 300]);
    toast('Descanso terminado');
    return;
  }
  restEl.querySelector('#rest-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// Precisa rodar dentro de um toque: é quando o navegador permite baixar o arquivo sem perguntar.
function autoBackup() {
  try {
    const now = new Date();
    const file = `fitmonjaro-${today()}-${hhmm(now).replace(':', '')}.json`;
    state.lastBackup = { file, at: now.toISOString() };
    download(file, JSON.stringify(state, null, 2));
  } catch {
    // Sem cópia desta vez; os dados continuam salvos no aparelho.
  }
}

function finishSession(id, status, quick) {
  const rec = sessionRec(id);
  rec.status = status;
  rec.finishedOn = today();
  if (quick) rec.quick = true;
  stopRest();
  autoBackup();
  save();
  location.hash = `#/concluido/${id}`;
}

/* ---------- Eventos ---------- */

const onField = {
  daily(el) {
    const date = today();
    state.daily[date] ??= {};
    state.daily[date][el.dataset.field] = el.value;
  },
  set(el) {
    const log = exerciseLog(el.dataset.s, el.dataset.ex);
    log.sets[el.dataset.i] = { ...log.sets[el.dataset.i], value: el.value };
    if (log.sets[el.dataset.i].done && Number(el.value) > 0) remember(el.dataset.ex, { value: Number(el.value) });
    refreshReady(el);
  },
  setdone(el) {
    const log = exerciseLog(el.dataset.s, el.dataset.ex);
    const row = el.closest('.set');
    const input = row.querySelector('input[type=number]');
    if (el.checked && !input.value) input.value = input.placeholder; // Marcar aceita a sugestão, sem digitar.
    log.sets[el.dataset.i] = { ...log.sets[el.dataset.i], value: input.value, done: el.checked };
    row.classList.toggle('done', el.checked);
    const band = view.querySelector(`select[data-ex="${el.dataset.ex}"]`);
    if (band && !log.band) log.band = band.value;
    if (el.checked && Number(input.value) > 0) remember(el.dataset.ex, { value: Number(input.value), ...(log.band ? { band: log.band } : {}) });
    refreshReady(el);
    if (el.checked && el.dataset.last === '1' && Number(el.dataset.rest) > 0) startRest(Number(el.dataset.rest));
  },
  pyramid(el) { exerciseLog(el.dataset.s, el.dataset.ex).sets = el.checked ? [{ done: true }] : []; },
  band(el) {
    exerciseLog(el.dataset.s, el.dataset.ex).band = el.value;
    remember(el.dataset.ex, { band: el.value });
  },
  light(el) {
    sessionRec(el.dataset.s).light = el.checked;
    save();
    render({ keepScroll: true });
  },
  pain(el) {
    sessionRec(el.dataset.s).pain = Number(el.value);
    document.getElementById('pain-out').textContent = el.value;
  },
  notes(el) { sessionRec(el.dataset.s).notes = el.value; },
};

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  onField[el.dataset.f]?.(el);
  save();
});

function activateImportedPlan(p) {
  state.plans[p.id] = p;
  state.planStarts[p.id] ??= nextMonday(today());
  state.activePlanId = p.id;
}

const importers = {
  async backup(text) {
    const parsed = parseBackup(text);
    if (!confirm('Recuperar este backup substitui os dados atuais deste aparelho. Continuar?')) return;
    state = parsed;
    save();
    toast('Backup recuperado');
  },
  async 'setup-plan'(text) {
    setupPlan = parsePlan(text);
  },
  async plan(text) {
    const parsed = parsePlan(text);
    const exists = Object.hasOwn(state.plans, parsed.id);
    if (!confirm(exists ? `Substituir o plano "${state.plans[parsed.id].name}"? O histórico será mantido.` : `Usar o plano "${parsed.name}"?`)) return;
    activateImportedPlan(parsed);
    save();
    toast('Plano importado');
  },
};

// No Android o seletor de arquivos abre outra tela: ao voltar, o app não pode redesenhar a tela,
// senão o campo de arquivo é trocado antes de receber o arquivo escolhido.
let pickingFile = false;
document.addEventListener('click', (e) => { if (e.target.matches?.('input[type=file]')) pickingFile = true; });
document.addEventListener('cancel', (e) => { if (e.target.matches?.('input[type=file]')) pickingFile = false; }, true);

document.addEventListener('change', async (e) => {
  const kind = e.target.dataset?.import;
  if (!kind) return;
  pickingFile = false;
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    await importers[kind](await file.text());
    render();
  } catch (err) {
    toast(err.message || 'Não foi possível importar o arquivo');
  }
});

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const actions = {
  'setup-change-plan'() {
    setupPlan = null;
    render();
  },
  step(el) {
    const input = el.parentElement.querySelector('input[type=number]');
    const current = Number(input.value || input.placeholder) || 0;
    const size = exerciseOf(input.dataset.ex).unit === 's' ? 5 : 1;
    input.value = Math.max(0, current + Number(el.dataset.delta) * size);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'add-set'(el) {
    const log = exerciseLog(el.dataset.s, el.dataset.ex);
    const inherited = sessionRec(el.dataset.s).light ? 0 : choicesOf()[el.dataset.ex]?.extra ?? 0;
    log.extra = (log.extra ?? inherited) + 1;
    remember(el.dataset.ex, { extra: log.extra });
    save();
    render({ keepScroll: true });
  },
  'note-chip'(el) {
    const box = document.getElementById('notes');
    box.value = box.value ? `${box.value}; ${el.dataset.text}` : el.dataset.text;
    box.closest('details').open = true;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'toggle-daily'(el) {
    const date = today();
    state.daily[date] ??= {};
    state.daily[date][el.dataset.field] = !state.daily[date][el.dataset.field];
    save();
    render({ keepScroll: true });
  },
  finish(el) { finishSession(el.dataset.s, el.dataset.status, false); },
  quick(el) { finishSession(el.dataset.s, el.dataset.status, true); },
  'del-entry'(el) {
    const { kind, date } = el.dataset;
    if (!confirm(`Apagar o registro de ${fmtDate(date)}?`)) return;
    state[kind] = state[kind].filter((e) => e.date !== date);
    save();
    render({ keepScroll: true });
  },
  'export-plan'(el) {
    download(`plano-${el.dataset.plan}.json`, JSON.stringify(state.plans[el.dataset.plan], null, 2));
  },
  'use-plan'(el) {
    const p = state.plans[el.dataset.plan];
    if (!confirm(`Usar o plano "${p.name}"? O histórico do plano atual será mantido.`)) return;
    activateImportedPlan(p);
    save();
    location.hash = '#/hoje';
    render();
  },
  'del-plan'(el) {
    const id = el.dataset.plan;
    if (Object.values(state.sessions[id] ?? {}).some(isFinished)) {
      toast('Este plano tem treinos registrados e não pode ser apagado.');
      return;
    }
    if (!confirm(`Apagar o plano "${state.plans[id].name}"?`)) return;
    delete state.plans[id];
    delete state.planStarts[id];
    delete state.sessions[id];
    save();
    render({ keepScroll: true });
  },
  wipe() {
    if (!confirm('Apagar todos os dados deste aparelho, inclusive os planos em elaboração? As cópias em Downloads continuam lá.')) return;
    state = emptyState();
    save();
    location.hash = '#/hoje';
    render();
  },
  'update-apply'() {
    updateRequested = true;
    if (swReg?.waiting) swReg.waiting.postMessage('skipWaiting');
    else location.reload();
  },
  async 'update-check'() {
    if (!swReg) {
      toast('Atualização indisponível neste navegador.');
      return;
    }
    toast('Verificando…');
    try {
      await checkForUpdate();
    } catch {
      toast('Sem conexão: tente de novo quando estiver on-line.');
      return;
    }
    const found = await settledUpdate();
    if (!found) toast('Você já está com a versão mais recente.');
    else toast('Nova versão pronta: toque em Atualizar.');
  },
  'rest-add'() { restEnd += 30000; tickRest(); },
  'rest-stop': stopRest,
  ...editorActions,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el) actions[el.dataset.a]?.(el);
});

const optionalNumber = (v) => (v === '' || v === undefined ? null : Number(v));

function applyProfile(d) {
  state.profile = {
    ...state.profile,
    name: d.name.trim(),
    sex: d.sex,
    birthDate: d.birthDate,
    height: Number(d.height),
    targetWeight: optionalNumber(d.targetWeight),
    conditions: d.conditions.trim(),
  };
}

const forms = {
  setup(d) {
    applyProfile(d);
    state.plans[setupPlan.id] = setupPlan;
    state.planStarts[setupPlan.id] = mondayOf(d.startDate);
    state.activePlanId = setupPlan.id;
    setupPlan = null;
    state.measurements = mergeMeasurement(state.measurements, { date: today(), weight: Number(d.weight) });
    if ('storage' in navigator) navigator.storage.persist?.().catch(() => {});
  },
  profile(d) {
    applyProfile(d);
    toast('Perfil salvo');
  },
  'plan-start'(d) {
    state.planStarts[state.activePlanId] = mondayOf(d.startDate);
    toast('Início salvo');
  },
  'quick-weight'(d) {
    state.measurements = mergeMeasurement(state.measurements, { date: today(), weight: Number(d.weight) });
    toast('Peso salvo');
  },
  measurement(d) {
    state.measurements = mergeMeasurement(state.measurements, {
      date: d.date, weight: Number(d.weight), visceral: optionalNumber(d.visceral), fat: optionalNumber(d.fat), muscle: optionalNumber(d.muscle),
    });
    toast('Medição salva');
  },
  injection(d) {
    state.injections = upsertByDate(state.injections, { date: d.date, dose: Number(d.dose) });
    toast('Aplicação salva');
  },
};

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form](Object.fromEntries(new FormData(form)));
  if (BACKUP_FORMS.has(form.dataset.form)) autoBackup();
  save();
  render({ keepScroll: true });
});

window.addEventListener('hashchange', () => render());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || pickingFile || location.hash.startsWith('#/editor')) return;
  if (location.hash.startsWith('#/sessao')) syncWakeLock(true);
  else if (!plan() || location.hash === '' || location.hash === '#/hoje') {
    if (!view.contains(document.activeElement)) render({ keepScroll: true }); // O dia pode ter mudado.
  }
});

Object.assign(importers, editorImporters);

/* ---------- Atualização do app ---------- */

// O aviso só aparece quando já há uma versão em uso: a primeira instalação não é atualização.
function showUpdate() {
  updateEl.hidden = !(swReg?.waiting && navigator.serviceWorker.controller);
}

function checkForUpdate() {
  lastUpdateCheck = Date.now();
  return swReg.update();
}

// Espera o download terminar. Devolve true se houver uma versão nova em espera.
function settledUpdate() {
  const worker = swReg.installing;
  if (!worker) return Promise.resolve(Boolean(swReg.waiting));
  return new Promise((resolve) => {
    const done = () => {
      if (worker.state === 'installing') return;
      worker.removeEventListener('statechange', done);
      resolve(Boolean(swReg.waiting));
    };
    worker.addEventListener('statechange', done);
    done();
  });
}

async function setupUpdates() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // Com outra versão baixada, a mais antiga é a que está em uso.
    const versions = (await caches.keys()).map((k) => Number(k.match(/^fitmonjaro-v(\d+)$/)?.[1])).filter(Boolean);
    if (versions.length) appVersion = String(Math.min(...versions));
    swReg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch {
    return;
  }
  swReg.addEventListener('updatefound', () => {
    const worker = swReg.installing;
    worker?.addEventListener('statechange', showUpdate);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload(); // Só recarrega a pedido: nunca no meio de um treino.
  });
  showUpdate();
  checkForUpdate().catch(() => {}); // Sem conexão: tenta de novo na próxima abertura.
}

// No Android o app costuma voltar do fundo sem recarregar, então a abertura não basta.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && swReg && Date.now() - lastUpdateCheck > UPDATE_INTERVAL) checkForUpdate().catch(() => {});
});

// Plano vindo do editor: substitui ou ativa neste aparelho; sem perfil, segue para a configuração.
function usePlan(p) {
  if (!plan()) {
    setupPlan = p;
    location.hash = '#/hoje';
    return;
  }
  const exists = Object.hasOwn(state.plans, p.id);
  if (!confirm(exists ? `Substituir o plano "${state.plans[p.id].name}" neste aparelho? O histórico será mantido.` : `Usar o plano "${p.name}" neste aparelho?`)) return;
  activateImportedPlan(p);
  save();
  toast('Plano em uso atualizado');
  location.hash = '#/plano';
}

initEditor({ state: () => state, save, render, toast, download, esc, importButton, activePlan: plan, usePlan });

async function boot() {
  try {
    state = await loadState();
  } catch {
    state = emptyState();
    loadError = true;
  }
  if (plan()) navigator.storage?.persist?.().catch(() => {});
  render();
  setupUpdates();
}

boot();
