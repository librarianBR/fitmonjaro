// Editor de planos: cria, altera, exclui, importa e exporta planos completos.
// Cada rascunho fica no banco do aparelho e é salvo a cada alteração.
import { icon } from './icons.js';
import { blankDraft, draftFromPlan, draftProblem, parsePlan, planFromDraft, renameInDraft, validatePlan } from './logic.js';

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const UNITS = [['reps', 'repetições'], ['s', 'segundos'], ['passos', 'passos']];
const TASK_ICONS = [['walk', 'Caminhada'], ['mobility', 'Mobilidade'], ['strength', 'Força'], ['water', 'Água'], ['protein', 'Alimentação'], ['weight', 'Peso'], ['med', 'Remédio']];
const TASK_LISTS = [['', 'Nenhuma'], ['mobility', 'Mobilidade'], ['warmup', 'Aquecimento']];
const SAVE_DELAY = 400;

let ctx = null; // Funções do app: estado, gravação, desenho da tela, avisos.
let currentId = '';
let saveTimer = null;
const openSections = new Set(['id']);

export function initEditor(context) {
  ctx = context;
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('toggle', onToggle, true);
  // Grava na hora o que ainda espera o intervalo, se o app for para o fundo ou fechar.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
}

const drafts = () => (ctx.state().drafts ??= {});
const esc = (v) => ctx.esc(v);
const stamp = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  ctx.save();
}

function touch(draft) {
  draft.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; ctx.save(); }, SAVE_DELAY);
}

function addDraft(plan) {
  const id = newId();
  drafts()[id] = { id, updatedAt: new Date().toISOString(), plan };
  ctx.save();
  openSections.clear();
  openSections.add('id');
  location.hash = `#/editor/${id}`;
}

/* ---------- Telas ---------- */

export function editorView(param) {
  flush();
  currentId = param && Object.hasOwn(drafts(), param) ? param : '';
  return currentId ? draftView(drafts()[currentId]) : listView();
}

function listView() {
  const list = Object.values(drafts()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const active = ctx.activePlan();
  return `
    <p><a href="${active ? '#/plano' : '#/hoje'}">‹ Voltar</a></p>
    <h1>${icon('plan')} Editor de planos</h1>
    <p class="muted">Monte um plano completo. Cada alteração é salva sozinha neste aparelho, então dá para elaborar aos poucos. Quando estiver pronto, <strong>Exporte</strong>: o arquivo .json é o que se usa no app de quem vai treinar.</p>
    <div class="stack">
      <button class="primary" data-a="ed-new">${icon('plus')} Novo plano em branco</button>
      ${active ? `<button class="ghost" data-a="ed-copy">${icon('plan')} Alterar o plano em uso</button>` : ''}
      ${ctx.importButton('draft', 'Importar plano (.json)')}
    </div>
    <section class="card"><h2>Planos em elaboração</h2>
      ${list.length ? `<ul class="entries">${list.map((d) => {
        const problem = draftProblem(d.plan);
        return `<li><a class="grow" href="#/editor/${esc(d.id)}"><strong>${esc(d.plan.name || 'Sem nome')}</strong><br>
          <span class="muted">${problem ? `${icon('alert')} Incompleto` : `${icon('check')} Pronto`} · alterado ${esc(stamp(d.updatedAt))}</span></a>
          <span class="row">
            <button type="button" class="icon-btn" aria-label="Exportar ${esc(d.plan.name)}" data-a="ed-export" data-d="${esc(d.id)}">${icon('save')}</button>
            <button type="button" class="icon-btn" aria-label="Excluir ${esc(d.plan.name)}" data-a="ed-delete" data-d="${esc(d.id)}">${icon('trash')}</button>
          </span></li>`;
      }).join('')}</ul>` : '<p class="muted">Nenhum plano em elaboração.</p>'}
    </section>`;
}

function statusLine(plan) {
  const problem = draftProblem(plan);
  return problem
    ? `<p id="ed-status" class="ed-status warn">${icon('alert')} <span>Falta ajustar: ${esc(problem)}</span></p>`
    : `<p id="ed-status" class="ed-status ok">${icon('check')} <span>Plano completo: pronto para exportar.</span></p>`;
}

function draftView(d) {
  const m = d.plan;
  return `
    <p><a href="#/editor">‹ Planos em elaboração</a></p>
    <h1 id="ed-title">${esc(m.name || 'Sem nome')}</h1>
    <p id="saved" class="saved" role="status">${icon('check')} Salvo automaticamente</p>
    ${statusLine(m)}
    <div class="ed-actions">
      <button class="primary" data-a="ed-export" data-d="${esc(d.id)}">${icon('save')} Exportar</button>
      <button class="ghost" data-a="ed-use" data-d="${esc(d.id)}">${icon('play')} Usar</button>
      <button class="ghost" data-a="ed-delete" data-d="${esc(d.id)}">${icon('trash')} Excluir</button>
    </div>
    ${section('id', 'Identificação', `
      ${text('Nome do plano', 'name', m.name)}
      ${text('Id', 'id', m.id, { hint: 'Letras, números, - e _. Um plano importado com o mesmo id substitui o anterior e mantém o histórico de treinos.' })}
      <div class="two">${text('Versão', 'version', m.version)}${text('Rótulo da dor', 'painLabel', m.painLabel, { hint: 'Ex.: Dor no joelho. Vazio: "Dor".' })}</div>
      ${text('Descrição', 'description', m.description, { long: true })}`)}
    ${section('series', 'Duração e séries', `
      <div class="three">${num('Semanas', 'durationWeeks', m.durationWeeks)}${num('Séries máx.', 'maxRounds', m.maxRounds)}${num('Séries leve', 'lightRounds', m.lightRounds)}</div>
      <p class="muted">Séries por exercício em cada período:</p>
      ${rows('roundsByWeek', m.roundsByWeek, (r, p) => `<div class="three">${num('Da semana', `${p}.fromWeek`, r.fromWeek)}${num('Até', `${p}.toWeek`, r.toWeek)}${num('Séries', `${p}.rounds`, r.rounds)}</div>`, 'round', 'período')}
      ${nums('Semanas da tabela de evolução', 'reviewWeeks', m.reviewWeeks, 'Separe por vírgula. Ex.: 1, 4, 8, 12')}`)}
    ${section('agenda', 'Calendário', `
      ${days('Dias de treino', 'schedule.days', m.schedule.days)}
      <p class="muted">Ordem dos treinos em cada semana: um id de treino por dia de treino, separados por espaço. As semanas se repetem em ciclo. Treinos: ${m.workouts.map((w) => `<b>${esc(w.id)}</b>`).join(', ') || 'nenhum'}.</p>
      ${rows('schedule.rotation', m.schedule.rotation, (r, p, i) => words(`Semana ${i + 1} do ciclo`, p, r), 'week', 'semana')}`)}
    ${section('phases', 'Fases', rows('phases', m.phases, (f, p) => `
      ${text('Nome', `${p}.name`, f.name)}
      <div class="two">${num('Da semana', `${p}.fromWeek`, f.fromWeek)}${num('Até', `${p}.toWeek`, f.toWeek)}</div>
      ${text('Foco', `${p}.focus`, f.focus)}`, 'phase', 'fase', true))}
    ${section('exercises', `Exercícios (${m.exercises.length})`, items('exercises', m.exercises, (e) => `${e.id} · ${e.name || 'sem nome'}`, (e, p) => `
      <div class="two">${text('Id', `${p}.id`, e.id, { ref: 'exercise', hint: 'Mudar o id num plano já em uso separa o histórico deste exercício.' })}${text('Nome', `${p}.name`, e.name)}</div>
      <div class="two">${text('Alvo (texto)', `${p}.target`, e.target, { hint: 'Ex.: 10–12' })}${select('Unidade', `${p}.unit`, e.unit, UNITS)}</div>
      <div class="two">${num('Mínimo', `${p}.min`, e.min)}${num('Máximo', `${p}.max`, e.max)}</div>
      ${text('Carga', `${p}.load`, e.load, { hint: 'Ex.: Elástico leve' })}
      ${check('Usa elástico (pede o nível no treino)', `${p}.band`, e.band)}
      ${text('Como fazer', `${p}.how`, e.how, { long: true })}
      ${videoFields(p, e.video)}`, 'exercise', 'exercício'))}
    ${section('workouts', `Treinos (${m.workouts.length})`, items('workouts', m.workouts, (w) => `${w.id} · ${w.title || 'sem título'}`, (w, p) => `
      <div class="three">${text('Id', `${p}.id`, w.id, { ref: 'workout' })}${text('Título', `${p}.title`, w.title)}${num('Minutos', `${p}.estimatedMinutes`, w.estimatedMinutes)}</div>
      ${rows(`${p}.blocks`, w.blocks, (b, bp, j) => `
        <p><strong>Bloco ${j + 1}</strong></p>
        <div class="two">${select('Tipo', `${bp}.type`, b.type, [['sets', 'Séries'], ['pyramid', 'Pirâmide 5‑3‑1']])}${text('Nome', `${bp}.label`, b.label)}</div>
        <div class="two">${num('Séries fixas', `${bp}.rounds`, b.rounds, 'Vazio: segue a semana.')}${num('Descanso (s)', `${bp}.restSeconds`, b.restSeconds)}</div>
        ${words('Exercícios do bloco', `${bp}.items`, b.items, `Ids separados por espaço. Disponíveis: ${m.exercises.map((e) => e.id).join(' ')}`)}
        ${text('Instruções', `${bp}.instructions`, b.instructions, { long: true })}`, 'block', 'bloco', true)}`, 'workout', 'treino'))}
    ${section('warmup', 'Aquecimento', listFields('warmup', m.warmup))}
    ${section('mobility', 'Mobilidade', listFields('mobility', m.mobility))}
    ${section('daily', 'Rotina diária', `
      <p class="muted">Hidratação e proteína já aparecem sempre; não use os ids water nem protein.</p>
      ${rows('dailyTasks', m.dailyTasks, (t, p) => `
        <div class="two">${text('Id', `${p}.id`, t.id)}${text('Nome', `${p}.label`, t.label, { hint: 'Ex.: Alongamento' })}</div>
        ${days('Dias', `${p}.days`, t.days)}
        <div class="two">${select('Ícone', `${p}.icon`, t.icon, [['', 'Padrão'], ...TASK_ICONS])}${select('Lista exibida', `${p}.list`, t.list, TASK_LISTS)}</div>`, 'task', 'atividade', true)}`)}
    ${section('bands', 'Níveis de elástico', lines('Um nível por linha, do mais leve ao mais forte', 'bandLevels', m.bandLevels))}
    ${section('guidance', 'Orientações', `
      ${text('Esforço', 'guidance.effort', m.guidance.effort, { long: true })}
      ${text('Progressão', 'guidance.progression', m.guidance.progression, { long: true })}
      ${text('Sobre os vídeos', 'guidance.videos', m.guidance.videos, { long: true })}`)}
    ${section('safety', 'Segurança', `
      ${text('Título da emergência', 'safety.emergencyTitle', m.safety.emergencyTitle)}
      ${lines('Sinais de emergência (um por linha)', 'safety.emergency', m.safety.emergency)}
      ${lines('Quando parar o exercício', 'safety.stop', m.safety.stop)}
      ${lines('Evitar', 'safety.avoid', m.safety.avoid)}
      ${lines('Sempre', 'safety.always', m.safety.always)}`)}`;
}

/* ---------- Campos ---------- */

const hintP = (hint) => (hint ? `<small class="muted">${esc(hint)}</small>` : '');

function section(key, title, body) {
  return `<details class="card ed-section" data-sec="${key}" ${openSections.has(key) ? 'open' : ''}><summary>${esc(title)}</summary><div class="stack">${body}</div></details>`;
}

function text(label, path, value, { long = false, hint = '', ref = '' } = {}) {
  const attrs = `data-ed="${path}" data-k="text"${ref ? ` data-ref="${ref}" data-old="${esc(value)}"` : ''}`;
  const field = long
    ? `<textarea rows="3" ${attrs}>${esc(value)}</textarea>`
    : `<input ${attrs} value="${esc(value)}">`;
  return `<label>${esc(label)} ${field}${hintP(hint)}</label>`;
}

const num = (label, path, value, hint = '') => `<label>${esc(label)} <input type="number" inputmode="numeric" min="0" step="1" data-ed="${path}" data-k="num" value="${esc(value)}">${hintP(hint)}</label>`;

const check = (label, path, value) => `<label class="switch"><input type="checkbox" data-ed="${path}" data-k="bool" ${value ? 'checked' : ''}> ${esc(label)}</label>`;

const lines = (label, path, value) => `<label>${esc(label)} <textarea rows="${Math.max(3, value.length + 1)}" data-ed="${path}" data-k="lines">${esc(value.join('\n'))}</textarea></label>`;

const words = (label, path, value, hint = '') => `<label>${esc(label)} <input data-ed="${path}" data-k="words" value="${esc(value.join(' '))}" autocapitalize="characters">${hintP(hint)}</label>`;

const nums = (label, path, value, hint = '') => `<label>${esc(label)} <input inputmode="numeric" data-ed="${path}" data-k="nums" value="${esc(value.join(', '))}">${hintP(hint)}</label>`;

const select = (label, path, value, list) => {
  const options = list.some(([v]) => v === value) ? list : [[value, value], ...list]; // Mantém um valor que não está na lista.
  return `<label>${esc(label)} <select data-ed="${path}" data-k="text">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
};

const days = (label, path, value) => `<fieldset class="ed-days"><legend>${esc(label)}</legend>${DAYS.map((d, i) => `
  <label><input type="checkbox" data-ed="${path}" data-k="days" data-day="${i}" ${value.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</fieldset>`;

const videoFields = (p, video) => `<div class="two">${text('Vídeo: descrição', `${p}.video.label`, video.label)}${text('Vídeo: link https', `${p}.video.url`, video.url)}</div>`;

const listFields = (key, list) => `
  ${text('Título', `${key}.title`, list.title)}
  ${rows(`${key}.items`, list.items, (item, p) => `
    <div class="two">${text('Nome', `${p}.name`, item.name)}${text('Dose', `${p}.dose`, item.dose, { hint: 'Ex.: 8 repetições' })}</div>
    ${videoFields(p, item.video)}`, 'step', 'item', true)}
  ${text('Observação', `${key}.note`, list.note, { long: true })}`;

// Lista simples: cada linha com o botão de remover; um botão para adicionar no fim.
function rows(path, list, render, tpl, noun, boxed = false) {
  return `<div class="ed-rows">${list.map((item, i) => `
    <div class="ed-row ${boxed ? 'boxed' : ''}">${render(item, `${path}.${i}`, i)}
      <button type="button" class="ghost small" data-a="ed-remove" data-path="${path}.${i}">${icon('trash')} Remover ${noun}</button>
    </div>`).join('')}
    <button type="button" class="ghost small" data-a="ed-add" data-path="${path}" data-tpl="${tpl}">${icon('plus')} Adicionar ${noun}</button></div>`;
}

// Lista de itens grandes (exercícios, treinos): cada um recolhido, com resumo.
function items(path, list, summary, render, tpl, noun) {
  return `${list.map((item, i) => `
    <details class="ed-item" data-sec="${path}.${i}" ${openSections.has(`${path}.${i}`) ? 'open' : ''}>
      <summary data-sum="${path}.${i}">${esc(summary(item))}</summary>
      <div class="stack">${render(item, `${path}.${i}`)}
        <button type="button" class="ghost small" data-a="ed-remove" data-path="${path}.${i}">${icon('trash')} Remover ${noun}</button>
      </div>
    </details>`).join('')}
    <button type="button" class="ghost small" data-a="ed-add" data-path="${path}" data-tpl="${tpl}">${icon('plus')} Adicionar ${noun}</button>`;
}

/* ---------- Alterações ---------- */

function getPath(root, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), root);
}

function setPath(root, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], root);
  parent[last] = value;
}

function readValue(el) {
  switch (el.dataset.k) {
    case 'num': return el.value === '' ? '' : Number(el.value);
    case 'bool': return el.checked;
    case 'lines': return el.value.split('\n').map((l) => l.trim()).filter(Boolean);
    case 'words': return el.value.split(/[\s,;]+/).filter(Boolean);
    case 'nums': return el.value.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isInteger);
    case 'days': return [...document.querySelectorAll(`[data-ed="${el.dataset.ed}"]`)].filter((c) => c.checked).map((c) => Number(c.dataset.day));
    default: return el.value;
  }
}

const current = () => (currentId && location.hash.startsWith('#/editor/') ? drafts()[currentId] : null);

function onInput(e) {
  const el = e.target.closest?.('[data-ed]');
  const d = el && current();
  if (!d) return;
  setPath(d.plan, el.dataset.ed, readValue(el));
  touch(d);
  const status = document.getElementById('ed-status');
  if (status) status.outerHTML = statusLine(d.plan);
  if (el.dataset.ed === 'name') document.getElementById('ed-title').textContent = d.plan.name || 'Sem nome';
  const item = el.dataset.ed.match(/^(exercises|workouts)\.(\d+)\./);
  if (item) {
    const it = d.plan[item[1]][item[2]];
    const sum = document.querySelector(`[data-sum="${item[1]}.${item[2]}"]`);
    if (sum) sum.textContent = `${it.id} · ${(item[1] === 'exercises' ? it.name : it.title) || 'sem nome'}`;
  }
}

// Ao terminar de renomear um exercício ou treino, atualiza quem o cita e redesenha a tela.
function onChange(e) {
  const el = e.target.closest?.('[data-ref]');
  const d = el && current();
  if (!d || el.dataset.old === el.value) return;
  renameInDraft(d.plan, el.dataset.ref, el.dataset.old, el.value.trim());
  setPath(d.plan, el.dataset.ed, el.value.trim());
  touch(d);
  flush();
  ctx.render({ keepScroll: true });
}

function onToggle(e) {
  const key = e.target.dataset?.sec;
  if (!key || !location.hash.startsWith('#/editor/')) return;
  if (e.target.open) openSections.add(key);
  else openSections.delete(key);
}

function unusedId(prefix, taken) {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
}

const templates = {
  round: () => ({ fromWeek: '', toWeek: '', rounds: '' }),
  week: (m) => [...(m.schedule.rotation.at(-1) ?? m.schedule.days.map(() => m.workouts[0]?.id ?? ''))],
  phase: () => ({ name: '', fromWeek: '', toWeek: '', focus: '' }),
  exercise: (m) => ({ id: unusedId('E', m.exercises.map((e) => e.id)), name: '', target: '10–12', min: 10, max: 12, unit: 'reps', load: '', band: false, how: '', video: { label: '', url: '' } }),
  workout: (m) => {
    const id = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((l) => !m.workouts.some((w) => w.id === l)) ?? unusedId('T', m.workouts.map((w) => w.id));
    return { id, title: `Treino ${id}`, estimatedMinutes: '', blocks: [templates.block()] };
  },
  block: () => ({ type: 'sets', label: '', rounds: '', restSeconds: 60, instructions: '', items: [] }),
  step: () => ({ name: '', dose: '', video: { label: '', url: '' } }),
  task: (m) => ({ id: unusedId('t', m.dailyTasks.map((t) => t.id)), label: '', days: [0, 1, 2, 3, 4], list: '', icon: '' }),
};

function download(plan) {
  ctx.download(`plano-${plan.id}.json`, `${JSON.stringify(plan, null, 2)}\n`);
}

function validPlanOf(id) {
  const d = drafts()[id];
  try {
    return validatePlan(planFromDraft(d.plan));
  } catch (err) {
    ctx.toast(`Ainda não dá: ${err.message.replace(/^Plano inválido: /, '')}`);
    return null;
  }
}

export const editorActions = {
  'ed-new'() {
    addDraft(blankDraft());
  },
  'ed-copy'() {
    addDraft(draftFromPlan(ctx.activePlan()));
  },
  'ed-export'(el) {
    flush();
    const plan = validPlanOf(el.dataset.d);
    if (!plan) return;
    download(plan);
    ctx.toast(`Arquivo plano-${plan.id}.json salvo em Downloads`);
  },
  'ed-use'(el) {
    flush();
    const plan = validPlanOf(el.dataset.d);
    if (plan) ctx.usePlan(plan);
  },
  'ed-delete'(el) {
    const d = drafts()[el.dataset.d];
    if (!d || !confirm(`Excluir "${d.plan.name || 'Sem nome'}" do editor? Exporte antes se quiser guardar uma cópia.`)) return;
    flush();
    delete drafts()[el.dataset.d];
    ctx.save();
    if (location.hash === '#/editor') ctx.render({ keepScroll: true });
    else location.hash = '#/editor';
    ctx.toast('Plano excluído do editor');
  },
  'ed-add'(el) {
    const d = current();
    if (!d) return;
    const list = getPath(d.plan, el.dataset.path);
    list.push(templates[el.dataset.tpl](d.plan));
    openSections.add(`${el.dataset.path}.${list.length - 1}`);
    touch(d);
    flush();
    ctx.render({ keepScroll: true });
  },
  'ed-remove'(el) {
    const d = current();
    if (!d) return;
    const keys = el.dataset.path.split('.');
    const index = Number(keys.pop());
    const list = getPath(d.plan, keys.join('.'));
    if (!confirm('Remover este item?')) return;
    list.splice(index, 1);
    // Os itens abaixo mudam de posição: as seções abertas deles seriam outras.
    for (const key of [...openSections]) if (key.startsWith(`${keys.join('.')}.`)) openSections.delete(key);
    touch(d);
    flush();
    ctx.render({ keepScroll: true });
  },
};

export const editorImporters = {
  async draft(text) {
    addDraft(draftFromPlan(parsePlan(text)));
    ctx.toast('Plano importado para o editor');
  },
};
