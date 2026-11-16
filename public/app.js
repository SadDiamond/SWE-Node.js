function find(selector) {
  return document.querySelector(selector);
}

function message(text) {
  find('#form-status').textContent = text;
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

// The server builds this MathML from the curve's own numbers, so it is safe to put straight into the page.
function mathNode(markup) {
  const holder = document.createElement('span');
  holder.className = 'math';
  holder.innerHTML = markup;
  return holder;
}

function goesText(count) {
  return count === 1 ? '1 attempt' : `${count} attempts`;
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error('You are offline. This needs a connection to the server.');
  }

  const isJson = (response.headers.get('Content-Type') || '').includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
  return data;
}

function send(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const ENDLESS_TOTAL = 'endlessTotal';
const SLOT_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const PEN_SPACING = 0.05;

function rounded(position) {
  return [Math.round(position.x * 100) / 100, Math.round(position.y * 100) / 100];
}

let currentUser = null;

const SEEN_HOW_TO_PLAY = 'seenHowToPlay';

function setUpHowToPlay() {
  const dialog = find('#how-to-play');
  find('#open-how-to-play').addEventListener('click', () => dialog.showModal());
  find('#close-how-to-play').addEventListener('click', () => dialog.close());
  try {
    if (localStorage.getItem(SEEN_HOW_TO_PLAY)) return;
    localStorage.setItem(SEEN_HOW_TO_PLAY, 'yes');
  } catch {
    return;
  }
  dialog.showModal();
}

async function playPage(endless) {
  setUpHowToPlay();
  const game = await request(endless ? `/api/endless${location.search}` : '/api/today');
  const graph = find('#graph');

  const rounds = game.curves.map((curve) => {
    const saved = curve.saved;
    return {
      ...curve,
      strokes: [],
      inkSpent: 0,
      shown: saved && saved.last ? saved.last : null,
      ghost: null,
      missed: saved && saved.last ? saved.last.missed : [],
      dots: saved ? saved.dots : [],
      goes: saved ? saved.goes : 0,
      history: [],
      result: saved ? saved.result : null
    };
  });
  let round = rounds.find((item) => !item.result) || rounds[rounds.length - 1];

  let strokeLength = 0;
  let beforeMarks = null;
  let percent = null;
  let waiting = false;
  const pen = { x: 0, y: 0, down: false, visible: false };

  function showGraph() {
    drawGraph(graph, {
      strokes: round.strokes,
      shown: round.shown,
      ghost: round.result ? null : round.ghost,
      percent,
      missed: round.missed,
      exits: round.exits,
      dots: round.dots,
      curve: round.result ? round.result.curve : null,
      asymptotes: round.result ? round.result.asymptotes : [],
      pen: pen.visible && !round.result ? pen : null
    }, game.limit);
  }

  function showInk() {
    const left = Math.max(0, Math.round((1 - round.inkSpent / round.ink) * 100));
    find('#ink-level').style.width = `${left}%`;
    find('.ink-bar').setAttribute('aria-valuenow', left);
    find('#ink').hidden = Boolean(round.result);
  }

  let drawQueued = false;
  function showStrokeSoon() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawLiveStroke(graph, round.strokes[round.strokes.length - 1], game.limit);
    });
  }

  let percentTimer = null;
  function flashPercent(value) {
    percent = value;
    clearTimeout(percentTimer);
    percentTimer = setTimeout(() => {
      percent = null;
      showGraph();
    }, 1800);
  }

  function countUp(target, from, to) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || from === to) {
      target.textContent = to;
      return;
    }
    const length = 900;
    const began = performance.now();
    function step(now) {
      const done = Math.min(1, (now - began) / length);
      const eased = 1 - (1 - done) ** 3;
      target.textContent = Math.round(from + (to - from) * eased);
      if (done < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const earlier = endless ? Number(sessionStorage.getItem(ENDLESS_TOTAL)) || 0 : 0;

  function totalScore() {
    return earlier + rounds.reduce((total, item) => total + (item.result ? item.result.score : 0), 0);
  }

  let totalOnScreen = earlier;
  function showTotal() {
    countUp(find('#total'), totalOnScreen, totalScore());
    totalOnScreen = totalScore();
  }

  let summaryOpen = false;
  let summarySeen = false;

  function showProgress() {
    if (endless) return;
    const list = find('#tabs');
    const allDone = rounds.every((item) => item.result);
    list.replaceChildren();

    rounds.forEach((item) => {
      let state = 'locked';
      let note = 'Locked';
      if (item.result) {
        state = 'done';
        note = `${item.result.score}`;
      } else if (item === round) {
        state = 'current';
        note = 'Now';
      }
      const label = [element('span', `${item.slot}. ${SLOT_NAMES[item.slot]}`), element('span', note, 'tab-score')];
      const step = element('li', undefined, `tab ${state}`);

      if (allDone) {
        const button = element('button', undefined, 'tab-button');
        button.type = 'button';
        button.append(...label);
        button.setAttribute('aria-label', `Look back at the ${SLOT_NAMES[item.slot].toLowerCase()} curve`);
        button.addEventListener('click', () => lookBack(item));
        if (!summaryOpen && item === round) step.classList.add('viewing');
        step.append(button);
      } else {
        step.append(...label);
        if (state === 'current') step.setAttribute('aria-current', 'step');
      }
      list.append(step);
    });
  }

  function lookBack(item) {
    round = item;
    summaryOpen = false;
    find('.layout').classList.remove('ended');
    find('#summary').hidden = true;
    message('');
    showRound();
  }

  function showRound() {
    const dots = find('#goes');
    dots.replaceChildren();
    for (let index = 0; index < game.maxGoes; index += 1) {
      dots.append(element('span', undefined, index < round.goes ? 'go used' : 'go'));
    }
    find('#goes-text').textContent = `${goesText(game.maxGoes - round.goes)} left`;

    const hintsLeft = game.maxHints - round.dots.length;
    find('#hint').disabled = hintsLeft === 0;
    find('#hint-text').textContent = hintsLeft === 0
      ? "You've used all your hints for this curve."
      : `A hint shows you one spot on the curve but costs ${game.hintPenalty} points (${hintsLeft} left).`;
    find('#hint-text').hidden = Boolean(round.result);

    find('#stroke-info').textContent = round.strokesPerGo === 1
      ? "You get one stroke per attempt and it's marked when you lift your pen."
      : `This one's in ${round.strokesPerGo} pieces, so you get ${round.strokesPerGo} strokes each attempt.`;
    find('#stroke-info').hidden = Boolean(round.result);
    find('.under-graph').hidden = Boolean(round.result);
    graph.classList.toggle('finished', Boolean(round.result));

    find('#result').hidden = !round.result;
    if (round.result) {
      const result = round.result;
      let heading = 'Out of attempts';
      if (result.solved) heading = `Cracked it in ${goesText(round.goes)}`;
      if (result.closeEnough) heading = `Close enough in ${goesText(round.goes)}`;
      find('#result-heading').textContent = heading;
      find('#result-close').hidden = !result.closeEnough;
      find('#result-top').textContent = `/ ${game.topScore}`;
      countUp(find('#result-score'), 0, result.score);

      const extraGoes = round.goes - 1;
      const lines = [`${result.accuracy}% accurate: ${result.accuracy * (game.topScore / 100)}`];
      if (extraGoes > 0) lines.push(`${goesText(extraGoes).replace('attempt', 'extra attempt')}: −${extraGoes * game.goPenalty}`);
      if (round.dots.length > 0) {
        lines.push(`${round.dots.length === 1 ? '1 hint' : `${round.dots.length} hints`}: −${round.dots.length * game.hintPenalty}`);
      }
      find('#result-working').replaceChildren(...lines.map((line) => element('li', line)));
      find('#result-family').textContent = result.familyName;
      find('#result-formula').replaceChildren(mathNode(result.formulaMath));

      const more = rounds.some((item) => !item.result);
      let nextLabel = 'Next curve';
      if (!more) nextLabel = summarySeen ? "Back to today's result" : "See today's result";
      if (endless) nextLabel = 'Another curve';
      find('#next-curve').textContent = nextLabel;
    }
    showProgress();
    showTotal();
    showInk();
    showGraph();
  }

  function showSummary() {
    const rows = find('#summary-rows');
    rows.replaceChildren();
    rounds.forEach((item, index) => {
      const row = document.createElement('li');
      row.style.setProperty('--order', index);
      const detail = `${item.result.familyName} · ${goesText(item.goes)}`
        + (item.dots.length > 0 ? ` · ${item.dots.length === 1 ? '1 hint' : `${item.dots.length} hints`}` : '');
      row.append(
        element('span', SLOT_NAMES[item.slot], 'summary-name'),
        element('span', detail, 'summary-detail'),
        element('span', item.result.score, 'summary-score')
      );
      rows.append(row);
    });

    find('#save-prompt').hidden = Boolean(currentUser);
    if (!currentUser) {
      localStorage.setItem(PENDING_RUN, JSON.stringify({
        date: game.date,
        curves: rounds.map((item) => ({ id: item.id, hints: item.dots.length, goes: item.history }))
      }));
    }

    summaryOpen = true;
    summarySeen = true;
    showProgress();
    find('.layout').classList.add('ended');
    find('#summary').hidden = false;
    countUp(find('#summary-total'), 0, totalScore());
    find('#summary-heading').focus();
  }

  find('#next-curve').addEventListener('click', () => {
    if (endless) {
      sessionStorage.setItem(ENDLESS_TOTAL, totalScore());
      return location.reload();
    }
    const next = rounds.find((item) => !item.result);
    if (!next) return showSummary();

    round = next;
    clearTimeout(percentTimer);
    percent = null;
    message('');
    showRound();
    find('#tabs').scrollIntoView({ block: 'nearest' });
  });

  find('#copy-result').addEventListener('click', async () => {
    const date = new Date(`${game.date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });
    const scores = rounds.map((item) => `${SLOT_NAMES[item.slot]} ${item.result.score}`).join(' · ');
    const text = `Placeholder, ${date}\n${scores}\nTotal ${totalScore()}`;
    try {
      await navigator.clipboard.writeText(text);
      find('#copy-status').textContent = 'Copied.';
    } catch (_error) {
      find('#copy-status').textContent = text;
    }
  });

  find('#hint').addEventListener('click', async () => {
    if (waiting || round.result) return;
    const asking = round;
    try {
      const hint = await send(`/api/machines/${asking.id}/hint`, { number: asking.dots.length + 1 });
      asking.dots.push(hint.dot);
      showRound();
    } catch (error) {
      message(error.message);
    }
  });

  function startStroke(position) {
    if (round.result || waiting) return false;
    beforeMarks = { shown: round.shown, ghost: round.ghost, missed: round.missed };
    if (round.strokes.length === 0 && round.shown) {
      round.ghost = round.shown;
      round.shown = null;
      round.missed = [];
    }
    clearTimeout(percentTimer);
    percent = null;
    strokeLength = 0;
    round.strokes.push([rounded(position)]);
    message('');
    showGraph();
    return true;
  }

  function extendStroke(position) {
    const stroke = round.strokes[round.strokes.length - 1];
    const [lastX, lastY] = stroke[stroke.length - 1];
    const moved = Math.hypot(position.x - lastX, position.y - lastY);
    if (moved < PEN_SPACING) return;
    const points = round.strokes.reduce((total, item) => total + item.length, 0);
    if (points >= game.mostPoints) return;
    if (round.inkSpent + moved > round.ink) {
      return message("You're out of ink, so lift your pen and it'll get marked.");
    }

    stroke.push(rounded(position));
    strokeLength += moved;
    round.inkSpent += moved;
    showInk();
    showStrokeSoon();
  }

  async function endStroke() {
    const outOfInk = () => round.ink - round.inkSpent < game.shortestStroke;
    if (strokeLength < game.shortestStroke) {
      round.strokes.pop();
      round.inkSpent -= strokeLength;
      showInk();
      round.shown = beforeMarks.shown;
      round.ghost = beforeMarks.ghost;
      round.missed = beforeMarks.missed;
      showGraph();
      if (round.strokes.length === 0 || !outOfInk()) {
        return message("That line was too short to count, so try drawing a longer one.");
      }
    }
    if (round.strokes.length < round.strokesPerGo && !outOfInk()) {
      showGraph();
      return message(`That's piece ${round.strokes.length} of ${round.strokesPerGo}, now draw the next one.`);
    }

    waiting = true;
    const marking = round;
    try {
      const result = await send(`/api/machines/${marking.id}/go`, {
        drawing: marking.strokes, go: marking.goes + 1, hints: marking.dots.length
      });
      marking.goes += 1;
      marking.history.push(marking.strokes);
      marking.shown = { strokes: marking.strokes, levels: result.levels, nudges: result.nudges };
      marking.missed = result.missed;
      if (result.finished) {
        marking.result = result;
        message('');
      } else {
        flashPercent(result.accuracy);
        message(`${result.accuracy}%, keep the green bits and fix up the rest.`);
      }
    } catch (error) {
      message(error.message);
    }
    marking.strokes = [];
    marking.inkSpent = 0;
    waiting = false;
    showRound();
  }

  let drawing = false;
  graph.addEventListener('pointerdown', (event) => {
    // Only the main button draws. A right-click opens a menu, and the page never hears that
    // button being released, which would leave the pen stuck down.
    if (event.button !== 0 || drawing) return;
    pen.visible = false;
    drawing = startStroke(graphPosition(graph, event, game.limit));
    if (drawing) graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    // If no button is held any more, the release was missed (for example it happened outside
    // the browser window), so the stroke ends here instead of carrying on by itself.
    if (event.buttons === 0) return liftPointer();
    extendStroke(graphPosition(graph, event, game.limit));
  });
  function liftPointer() {
    if (!drawing) return;
    drawing = false;
    endStroke();
  }
  graph.addEventListener('pointerup', liftPointer);
  graph.addEventListener('pointercancel', liftPointer);
  graph.addEventListener('lostpointercapture', liftPointer);
  window.addEventListener('pointerup', liftPointer);
  window.addEventListener('blur', liftPointer);
  graph.addEventListener('contextmenu', (event) => event.preventDefault());

  graph.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] };

    if (event.key === ' ') {
      event.preventDefault();
      if (pen.down) {
        pen.down = false;
        endStroke();
      } else if (startStroke(pen)) {
        pen.down = true;
        message('Your pen is down, so use the arrow keys to draw and press Space to lift it.');
      }
    }
    if (moves[event.key]) {
      event.preventDefault();
      pen.x = Math.max(-game.limit, Math.min(game.limit, pen.x + moves[event.key][0]));
      pen.y = Math.max(-game.limit, Math.min(game.limit, pen.y + moves[event.key][1]));
      if (pen.down) extendStroke(pen);
    }
    pen.visible = true;
    showGraph();
  });
  graph.addEventListener('blur', () => {
    pen.visible = false;
    showGraph();
  });

  window.addEventListener('resize', showGraph);

  if (endless) {
    const asked = new URLSearchParams(location.search).get('slot') || '';
    document.querySelectorAll('#levels a').forEach((choice) => {
      if (new URL(choice.href).searchParams.get('slot') === (asked || null)) choice.setAttribute('aria-current', 'true');
    });
    find('#today-date').textContent = `${SLOT_NAMES[round.slot]} curve`;
    showRound();
    return;
  }

  const date = new Date(`${game.date}T00:00`);
  find('#today-date').textContent = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  showRound();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const latest = await request('/api/today').catch(() => null);
    if (latest && latest.date !== game.date) location.reload();
  });

  if (rounds.every((item) => item.result)) showSummary();
}

const STATUS_NAMES = { solved: 'Cracked', failed: 'Out of attempts' };

function shortDate(date) {
  return new Date(`${date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function addRow(body, values) {
  const row = document.createElement('tr');
  values.forEach((value, index) => {
    const cell = document.createElement(index === 0 ? 'th' : 'td');
    if (index === 0) cell.scope = 'row';
    if (typeof value === 'number') cell.className = 'number';
    cell.append(value);
    row.append(cell);
  });
  body.append(row);
}

function membersOnly() {
  find('#guest').hidden = Boolean(currentUser);
  find('#content').hidden = !currentUser;
  return Boolean(currentUser);
}

function curveCell(row) {
  const cell = document.createElement('span');
  cell.append(`${row.familyName}: `, mathNode(row.formulaMath));
  return cell;
}

async function historyPage() {
  if (!membersOnly()) return;
  const form = find('#filters');

  const families = await request('/api/families');
  families.forEach((family) => find('#family').add(new Option(family.name, family.id)));

  async function load() {
    const choices = new URLSearchParams(new FormData(form));
    const rows = await request(`/api/history?${choices}`);

    const body = find('#history-rows');
    body.replaceChildren();
    rows.forEach((row) => {
      addRow(body, [
        shortDate(row.date),
        SLOT_NAMES[row.slot],
        curveCell(row),
        STATUS_NAMES[row.status],
        row.goes,
        row.hints,
        row.score
      ]);
    });
    find('#count').textContent = rows.length === 0
      ? "There's nothing here yet, so finish a curve or try changing the filters."
      : `${rows.length} ${rows.length === 1 ? 'curve' : 'curves'}`;
  }

  form.addEventListener('change', () => load().catch((error) => message(error.message)));
  await load();
}

async function statsPage() {
  if (!membersOnly()) return;
  const stats = await request('/api/stats');
  const totals = stats.totals;
  const days = (count) => (count === 1 ? '1 day' : `${count} days`);

  find('#stat-points').textContent = totals.points;
  find('#stat-days').textContent = totals.days;
  find('#stat-streak').textContent = days(stats.streak.current);
  find('#stat-best-streak').textContent = days(stats.streak.best);
  find('#stat-cracked').textContent = `${totals.cracked} of ${totals.played}`;
  find('#stat-average').textContent = totals.average_score ?? '–';
  find('#stat-goes').textContent = totals.average_goes ?? '–';
  find('#stat-best-day').textContent = stats.bestDay
    ? `${stats.bestDay.points} on ${shortDate(stats.bestDay.date)}`
    : '–';

  stats.byDifficulty.forEach((row) => {
    addRow(find('#difficulty-rows'), [SLOT_NAMES[row.slot], row.played, row.cracked, row.average_score, row.average_goes]);
  });
  stats.byFamily.forEach((row) => {
    addRow(find('#family-rows'), [row.name, row.played, row.cracked, row.average_score, row.best_score]);
  });
}

function onSubmit(form, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await action(Object.fromEntries(new FormData(form)));
    } catch (error) {
      message(error.message);
    }
  });
}

async function accountPage() {
  find('#logged-out').hidden = Boolean(currentUser);
  find('#logged-in').hidden = !currentUser;

  onSubmit(find('#login-form'), async (fields) => {
    await send('/api/login', fields);
    location.href = '/';
  });
  onSubmit(find('#signup-form'), async (fields) => {
    await send('/api/signup', fields);
    location.href = '/';
  });
  if (!currentUser) return;

  find('#account-name').textContent = currentUser.display_name;
  find('#account-username').textContent = currentUser.username;
  find('#account-created').textContent = new Date(`${currentUser.created_at.replace(' ', 'T')}Z`)
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  find('#logout-button').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' });
    location.href = '/';
  });
}

const PENDING_RUN = 'pendingRun';

async function savePendingRun() {
  const stored = localStorage.getItem(PENDING_RUN);
  if (!stored) return;
  localStorage.removeItem(PENDING_RUN);

  const run = JSON.parse(stored);
  const today = await request('/api/today');
  if (run.date !== today.date || today.curves.some((curve) => curve.saved)) return;

  for (const curve of run.curves) {
    for (let hint = 0; hint < curve.hints; hint += 1) {
      await send(`/api/machines/${curve.id}/hint`, {});
    }
    for (const drawing of curve.goes) {
      await send(`/api/machines/${curve.id}/go`, { drawing });
    }
  }
}

const pages = {
  today: () => playPage(false),
  endless: () => playPage(true),
  account: accountPage,
  history: historyPage,
  stats: statsPage
};

async function start() {
  const me = await request('/api/me');
  currentUser = me.user;
  if (currentUser) {
    find('#account-link').textContent = currentUser.display_name;
    await savePendingRun();
  }
  await pages[document.body.dataset.page]();
}

start().catch((error) => message(error.message));
