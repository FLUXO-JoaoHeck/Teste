/* =========================================================================
   SIMULADOR DE TANQUE — VÁLVULAS DE ALÍVIO DE PRESSÃO/VÁCUO (VAPV)
   Modelo educacional simplificado. Não representa nenhum fabricante,
   fluido ou norma técnica específica — apenas o comportamento conceitual
   descrito: bombeamento, inertização, VAPV e válvula de emergência,
   além dos efeitos de dilatação/contração térmica.
   ========================================================================= */

// ---------------------------------------------------------------------
// 1. PARÂMETROS E LIMIARES (mbar = milibar, pressão manométrica)
// ---------------------------------------------------------------------
const THRESH = {
  inertOpen: 0.4,      // abaixo disso, válvula de inertização injeta N2
  inertClose: 1.4,      // acima disso, inertização fecha
  vacuumRelief: -2.5,   // abaixo disso, VAPV abre para alívio de vácuo
  pressureRelief: 6.0,  // acima disso, VAPV abre para alívio de pressão
  emergency: 10.0,      // acima disso, válvula de emergência abre
  gaugeMax: 14,
  gaugeMin: -6,
};

const RATES = {
  pumpToPressure: 0.55,   // ganho: L/min de bombeamento -> mbar/s
  pumpToLevel: 0.10,       // ganho: L/min -> %/s de nível
  thermalGain: 0.045,      // ganho: variação de temperatura -> mbar/s (dilatação/contração)
  inertInject: 0.9,        // mbar/s enquanto inertização injeta N2
  vapvReliefGain: 1.6,     // capacidade de alívio da VAPV (proporcional ao excesso)
  emergencyReliefGain: 3.2,// capacidade de alívio da válvula de emergência
  ambientDrift: 0.02,      // tendência natural de retorno à pressão atmosférica
};

const DT = 0.2; // segundos por tick de simulação

// ---------------------------------------------------------------------
// 2. ESTADO
// ---------------------------------------------------------------------
const state = {
  pressure: 0,
  temperature: 25,
  prevTemperature: 25,
  level: 50,
  pumpRate: 0,       // L/min (slider) — positivo = enchendo, negativo = esvaziando
  simSeconds: 0,
  valves: {
    inert: false,
    vapvPressure: false,
    vapvVacuum: false,
    emergency: false,
  },
  vapvBlocked: false,
  chartPaused: false,
};

const history = []; // { t, pressure }
const MAX_HISTORY = 450; // ~90s de registro a 5 amostras/s

// ---------------------------------------------------------------------
// 3. ELEMENTOS DO DOM
// ---------------------------------------------------------------------
const el = {
  pressureValue: document.getElementById('pressureValue'),
  tempValue: document.getElementById('tempValue'),
  levelValue: document.getElementById('levelValue'),
  timeValue: document.getElementById('timeValue'),
  gaugeNeedle: document.getElementById('gaugeNeedle'),
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.getElementById('statusLabel'),

  liquidLevel: document.getElementById('liquidLevel'),
  liquidSurface: document.getElementById('liquidSurface'),

  nodeInert: document.getElementById('nodeInert'),
  nodeVapv: document.getElementById('nodeVapv'),
  nodeEmerg: document.getElementById('nodeEmerg'),
  ventOutArrows: document.getElementById('ventOutArrows'),
  ventInArrows: document.getElementById('ventInArrows'),
  inertFlow: document.querySelector('.inert-flow'),
  emergArrows: document.getElementById('emergArrows'),
  tempRulerPoints: document.getElementById('tempRulerPoints'),

  pumpInArrow: document.getElementById('pumpInArrow'),
  pumpOutArrow: document.getElementById('pumpOutArrow'),
  pumpInGroup: document.getElementById('pumpInGroup'),
  pumpOutGroup: document.getElementById('pumpOutGroup'),

  rowInert: document.getElementById('rowInert'),
  rowVapvP: document.getElementById('rowVapvP'),
  rowVapvV: document.getElementById('rowVapvV'),
  rowEmerg: document.getElementById('rowEmerg'),
  dotInert: document.getElementById('dotInert'),
  valInert: document.getElementById('valInert'),
  valVapvP: document.getElementById('valVapvP'),
  valVapvV: document.getElementById('valVapvV'),
  valEmerg: document.getElementById('valEmerg'),

  pumpSlider: document.getElementById('pumpSlider'),
  pumpSliderVal: document.getElementById('pumpSliderVal'),
  tempSlider: document.getElementById('tempSlider'),
  tempSliderVal: document.getElementById('tempSliderVal'),
  blockVapv: document.getElementById('blockVapv'),
  btnReset: document.getElementById('btnReset'),
  btnPauseChart: document.getElementById('btnPauseChart'),

  logList: document.getElementById('logList'),
  chartCanvas: document.getElementById('trendChart'),
};

const ctx = el.chartCanvas.getContext('2d');

// ---------------------------------------------------------------------
// 4. FÍSICA / LÓGICA DE VÁLVULAS (executada a cada tick)
// ---------------------------------------------------------------------
function step() {
  state.simSeconds += DT;

  // --- efeito do bombeamento sobre pressão e nível ---
  let dP = state.pumpRate * RATES.pumpToPressure * DT;
  state.level += state.pumpRate * RATES.pumpToLevel * DT;
  state.level = Math.max(0, Math.min(100, state.level));
  if (state.level <= 0 || state.level >= 100) {
    // tanque cheio ou vazio interrompe o bombeamento automaticamente
    state.pumpRate = 0;
    el.pumpSlider.value = 0;
    updatePumpLabel();
  }

  // --- efeito térmico: dilatação (aquecendo) eleva pressão, contração (resfriando) reduz ---
  const dT = state.temperature - state.prevTemperature;
  dP += dT * RATES.thermalGain * 40; // dT já é por tick, ganho ajustado
  state.prevTemperature = state.temperature;

  // --- tendência natural de retorno ao equilíbrio atmosférico (fuga natural) ---
  dP += -state.pressure * RATES.ambientDrift * DT;

  state.pressure += dP;

  // --- válvula de inertização (N2 blanket) ---
  if (!state.valves.inert && state.pressure < THRESH.inertOpen) {
    setValve('inert', true);
  } else if (state.valves.inert && state.pressure >= THRESH.inertClose) {
    setValve('inert', false);
  }
  if (state.valves.inert) {
    state.pressure += RATES.inertInject * DT;
  }

  // --- VAPV: alívio de pressão ---
  const vapvActive = !state.vapvBlocked;
  if (vapvActive) {
    if (!state.valves.vapvPressure && state.pressure > THRESH.pressureRelief) {
      setValve('vapvPressure', true);
    } else if (state.valves.vapvPressure && state.pressure <= THRESH.pressureRelief - 0.6) {
      setValve('vapvPressure', false);
    }
    if (state.valves.vapvPressure) {
      const excess = Math.max(0, state.pressure - THRESH.pressureRelief);
      state.pressure -= excess * RATES.vapvReliefGain * DT;
    }

    // --- VAPV: alívio de vácuo ---
    if (!state.valves.vapvVacuum && state.pressure < THRESH.vacuumRelief) {
      setValve('vapvVacuum', true);
    } else if (state.valves.vapvVacuum && state.pressure >= THRESH.vacuumRelief + 0.6) {
      setValve('vapvVacuum', false);
    }
    if (state.valves.vapvVacuum) {
      const deficit = Math.max(0, THRESH.vacuumRelief - state.pressure);
      state.pressure += deficit * RATES.vapvReliefGain * DT;
    }
  } else {
    // VAPV obstruída: força fechamento visual, pressão/vácuo seguem livres
    if (state.valves.vapvPressure) setValve('vapvPressure', false);
    if (state.valves.vapvVacuum) setValve('vapvVacuum', false);
  }

  // --- válvula de emergência (backup de alta capacidade) ---
  if (!state.valves.emergency && state.pressure > THRESH.emergency) {
    setValve('emergency', true);
  } else if (state.valves.emergency && state.pressure <= THRESH.emergency - 1.0) {
    setValve('emergency', false);
  }
  if (state.valves.emergency) {
    const excess = Math.max(0, state.pressure - THRESH.emergency);
    state.pressure -= excess * RATES.emergencyReliefGain * DT;
  }

  // limites físicos de exibição (não deixa disparar para o infinito)
  state.pressure = Math.max(-9, Math.min(18, state.pressure));

  history.push({ t: state.simSeconds, pressure: state.pressure });
  if (history.length > MAX_HISTORY) history.shift();

  render();
}

function setValve(name, isOpen) {
  const wasOpen = state.valves[name];
  state.valves[name] = isOpen;
  if (isOpen === wasOpen) return;
  logEvent(name, isOpen);
}

// ---------------------------------------------------------------------
// 5. LOG DE EVENTOS
// ---------------------------------------------------------------------
const LABELS = {
  inert: 'Válvula de inertização (N₂)',
  vapvPressure: 'VAPV — alívio de pressão',
  vapvVacuum: 'VAPV — alívio de vácuo',
  emergency: 'Válvula de emergência',
};
const CLASSES = {
  inert: 'inert',
  vapvPressure: 'warn',
  vapvVacuum: 'warn',
  emergency: 'crit',
};

function logEvent(name, isOpen) {
  const time = formatClock(state.simSeconds);
  const label = LABELS[name];
  const action = isOpen ? 'ATIVADA' : 'FECHADA';
  const cls = isOpen ? CLASSES[name] : 'safe';
  const entry = document.createElement('div');
  entry.className = `log-entry ${cls}`;
  entry.innerHTML = `<span class="t">${time}</span><span class="m">${label} — ${action}</span>`;
  el.logList.appendChild(entry);
  // limita o histórico visual
  while (el.logList.children.length > 60) {
    el.logList.removeChild(el.logList.firstChild);
  }
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------
// 6. RENDERIZAÇÃO
// ---------------------------------------------------------------------
function render() {
  // readouts numéricos
  el.pressureValue.textContent = state.pressure.toFixed(1);
  el.tempValue.textContent = `${state.temperature.toFixed(1)} °C`;
  el.levelValue.textContent = `${Math.round(state.level)} %`;
  el.timeValue.textContent = formatClock(state.simSeconds);

  // ponteiro do manômetro: -6 a +18 mapeado para -90deg..+90deg
  const clamped = Math.max(THRESH.gaugeMin, Math.min(THRESH.gaugeMax, state.pressure));
  const frac = (clamped - THRESH.gaugeMin) / (THRESH.gaugeMax - THRESH.gaugeMin);
  const angle = -90 + frac * 180;
  el.gaugeNeedle.style.transform = `rotate(${angle}deg)`;

  // nível de líquido no tanque (SVG: y=234 topo, y=556 fundo)
  const topY = 234, bottomY = 556;
  const liquidTop = bottomY - (state.level / 100) * (bottomY - topY);
  el.liquidLevel.setAttribute('y', liquidTop);
  el.liquidLevel.setAttribute('height', bottomY - liquidTop);
  el.liquidSurface.setAttribute('y1', liquidTop);
  el.liquidSurface.setAttribute('y2', liquidTop);

  updateTempRuler();

  // válvulas — visual
  toggleValveVisual('inert', state.valves.inert);
  toggleValveVisual('vapvPressure', state.valves.vapvPressure);
  toggleValveVisual('vapvVacuum', state.valves.vapvVacuum);
  toggleValveVisual('emergency', state.valves.emergency);

  // obstrução da VAPV: indicar visualmente (ícone esmaecido + contorno cinza)
  el.nodeVapv.style.opacity = state.vapvBlocked ? 0.4 : 1;
  el.nodeVapv.style.filter = state.vapvBlocked ? 'grayscale(1)' : 'none';

  // bombas
  const pumping = Math.abs(state.pumpRate) > 0.05;
  el.pumpInArrow.classList.toggle('active', pumping && state.pumpRate > 0);
  el.pumpOutArrow.classList.toggle('active', pumping && state.pumpRate < 0);
  el.pumpInGroup.querySelector('.pump-body').classList.toggle('active', pumping && state.pumpRate > 0);
  el.pumpOutGroup.querySelector('.pump-body').classList.toggle('active', pumping && state.pumpRate < 0);

  // status geral
  updateOverallStatus();

  // gráfico
  if (!state.chartPaused) drawChart();
}

function toggleValveVisual(name, isOpen) {
  const rowMap = { inert: el.rowInert, vapvPressure: el.rowVapvP, vapvVacuum: el.rowVapvV, emergency: el.rowEmerg };
  const valMap = { inert: el.valInert, vapvPressure: el.valVapvP, vapvVacuum: el.valVapvV, emergency: el.valEmerg };
  const row = rowMap[name];
  const valEl = valMap[name];
  row.classList.toggle('open', isOpen);
  row.classList.toggle('crit', name === 'emergency');
  row.classList.toggle('inert', name === 'inert');
  valEl.textContent = isOpen ? 'ATIVADA' : 'FECHADA';

  if (name === 'inert') {
    el.inertFlow.classList.toggle('active', isOpen);
  }
  if (name === 'vapvPressure') {
    el.ventOutArrows.classList.toggle('active', isOpen);
  }
  if (name === 'vapvVacuum') {
    el.ventInArrows.classList.toggle('active', isOpen);
  }
  if (name === 'emergency') {
    el.emergArrows.classList.toggle('active', isOpen);
  }

  // atualiza os nós de imagem (ícones substituíveis)
  el.nodeInert.classList.toggle('state-inert', state.valves.inert);
  const vapvOpen = state.valves.vapvPressure || state.valves.vapvVacuum;
  el.nodeVapv.classList.toggle('state-open', vapvOpen);
  el.nodeEmerg.classList.toggle('state-crit', state.valves.emergency);
}

// ---------------------------------------------------------------------
// RÉGUA DE TEMPERATURA MULTIPONTO (reservada para modelo de inventário futuro)
// Gera N pontos ao longo da extensão do tanque. Hoje todos refletem a
// mesma temperatura simulada (modelo de zona única); no futuro cada
// ponto pode receber seu próprio valor (perfil estratificado).
// ---------------------------------------------------------------------
const TEMP_POINTS = 6;
function buildTempRuler() {
  el.tempRulerPoints.innerHTML = '';
  for (let i = 0; i < TEMP_POINTS; i++) {
    const img = document.createElement('img');
    img.src = 'icons/instrument-temp-point.svg';
    img.alt = `Sensor de temperatura TE-${i + 1}`;
    img.dataset.index = i;
    el.tempRulerPoints.appendChild(img);
  }
}
function updateTempRuler() {
  const color = state.temperature > 45 ? '#ea4551' : state.temperature < 5 ? '#38bdf8' : '#f5a623';
  const glow = `drop-shadow(0 0 4px ${color})`;
  el.tempRulerPoints.querySelectorAll('img').forEach(img => {
    img.style.filter = glow;
  });
}

function updateOverallStatus() {
  let label = 'OPERAÇÃO NORMAL';
  let cls = '';
  if (state.valves.emergency) {
    label = 'ALERTA CRÍTICO — EMERGÊNCIA ATIVA';
    cls = 'crit';
  } else if (state.valves.vapvPressure || state.valves.vapvVacuum) {
    label = 'VAPV EM ALÍVIO';
    cls = 'warn';
  } else if (state.valves.inert) {
    label = 'INERTIZANDO';
    cls = '';
  }
  el.statusLabel.textContent = label;
  el.statusDot.className = 'status-dot' + (cls ? ' ' + cls : '');
}

// ---------------------------------------------------------------------
// 7. GRÁFICO DE TENDÊNCIA (canvas)
// ---------------------------------------------------------------------
function drawChart() {
  const w = el.chartCanvas.width, h = el.chartCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const yMin = THRESH.gaugeMin, yMax = THRESH.gaugeMax;
  const yToPx = (p) => h - ((p - yMin) / (yMax - yMin)) * h;

  // zonas de fundo
  drawZone(THRESH.emergency, yMax, 'rgba(234,69,81,0.10)');
  drawZone(THRESH.pressureRelief, THRESH.emergency, 'rgba(245,166,35,0.08)');
  drawZone(THRESH.vacuumRelief, THRESH.pressureRelief, 'rgba(79,214,122,0.06)');
  drawZone(yMin, THRESH.vacuumRelief, 'rgba(245,166,35,0.08)');

  function drawZone(p0, p1, color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, yToPx(p1), w, yToPx(p0) - yToPx(p1));
  }

  // linhas de limiar
  [
    [THRESH.emergency, 'rgba(234,69,81,0.5)'],
    [THRESH.pressureRelief, 'rgba(245,166,35,0.5)'],
    [THRESH.vacuumRelief, 'rgba(245,166,35,0.5)'],
    [0, 'rgba(215,230,240,0.2)'],
  ].forEach(([p, color]) => {
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yToPx(p));
    ctx.lineTo(w, yToPx(p));
    ctx.stroke();
    ctx.setLineDash([]);
  });

  if (history.length < 2) return;
  const tMax = history[history.length - 1].t;
  const tMin = Math.max(0, tMax - 90);
  const xToPx = (t) => ((t - tMin) / 90) * w;

  ctx.strokeStyle = '#4fd67a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((pt, i) => {
    if (pt.t < tMin) return;
    const x = xToPx(pt.t), y = yToPx(pt.pressure);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ponto atual
  const last = history[history.length - 1];
  ctx.fillStyle = '#4fd67a';
  ctx.beginPath();
  ctx.arc(xToPx(last.t), yToPx(last.pressure), 3.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------
// 8. CONTROLES DE UI
// ---------------------------------------------------------------------
function updatePumpLabel() {
  const v = parseFloat(el.pumpSlider.value);
  state.pumpRate = v;
  const dir = v > 0.05 ? 'enchendo' : v < -0.05 ? 'esvaziando' : 'parado';
  el.pumpSliderVal.textContent = `${v.toFixed(1)} L/min (${dir})`;
}
function updateTempLabel() {
  const v = parseFloat(el.tempSlider.value);
  state.temperature = v;
  el.tempSliderVal.textContent = `${v.toFixed(1)} °C`;
}

el.pumpSlider.addEventListener('input', updatePumpLabel);
el.tempSlider.addEventListener('input', updateTempLabel);
el.blockVapv.addEventListener('change', () => {
  state.vapvBlocked = el.blockVapv.checked;
  if (state.vapvBlocked) {
    logEvent('vapvPressure', false);
    const e = document.createElement('div');
    e.className = 'log-entry crit';
    e.innerHTML = `<span class="t">${formatClock(state.simSeconds)}</span><span class="m">FALHA SIMULADA: VAPV obstruída — capacidade de alívio normal indisponível</span>`;
    el.logList.appendChild(e);
  }
});

el.btnReset.addEventListener('click', () => {
  state.pressure = 0;
  state.temperature = 25;
  state.prevTemperature = 25;
  state.level = 50;
  state.pumpRate = 0;
  state.simSeconds = 0;
  state.vapvBlocked = false;
  Object.keys(state.valves).forEach(k => state.valves[k] = false);
  el.pumpSlider.value = 0;
  el.tempSlider.value = 25;
  el.blockVapv.checked = false;
  history.length = 0;
  el.logList.innerHTML = '';
  updatePumpLabel();
  updateTempLabel();
  render();
});

el.btnPauseChart.addEventListener('click', () => {
  state.chartPaused = !state.chartPaused;
  el.btnPauseChart.textContent = state.chartPaused ? 'Retomar registrador' : 'Pausar registrador';
});

// ---------------------------------------------------------------------
// 9. LOOP PRINCIPAL
// ---------------------------------------------------------------------
buildTempRuler();
updatePumpLabel();
updateTempLabel();
render();
setInterval(step, DT * 1000);
