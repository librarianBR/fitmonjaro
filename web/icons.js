// Ícones simples em linha (24x24). A cor vem do texto, então cada categoria herda a sua.
const svg = (body) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  plan: svg('<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9zM9 11h6M9 15h4"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  strength: svg('<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-3-3 1-5 3 3 3 1M10 12l-3 2-1 4"/>'),
  mobility: svg('<circle cx="12" cy="4" r="2"/><path d="M4 9l8 2 8-2M12 11v5l-4 5M12 16l4 5"/>'),
  water: svg('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
  protein: svg('<path d="M12 3c4 0 7 6 7 10a7 7 0 0 1-14 0c0-4 3-10 7-10z"/>'),
  weight: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 11a4 4 0 0 1 8 0M12 11l2-2"/>'),
  med: svg('<path d="M18 2l4 4M20 4l-4 4M15 5l4 4M14 6l-9 9-1 5 5-1 9-9M9 11l4 4"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  half: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  skip: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  play: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17v.5"/>'),
  band: svg('<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="12" rx="4" ry="1.5"/>'),
  rest: svg('<path d="M20 15A8 8 0 1 1 9 4a6 6 0 0 0 11 11z"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  folder: svg('<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  restore: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  note: svg('<path d="M4 4h16v12H8l-4 4z"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7M8 21v-7h8v7"/>'),
  flame: svg('<path d="M12 2c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};

export const icon = (name, extra = '') => (extra ? ICONS[name].replace('class="ico"', `class="ico ${extra}"`) : ICONS[name]);
