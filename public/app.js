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
    const error = new Error("You're offline, and this page needs a connection. Endless still works offline, though.");
    error.offline = true;
    throw error;
  }

  const isJson = (response.headers.get('Content-Type') || '').includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || 'Something went wrong. Try again.');
    error.status = response.status;
    throw error;
  }
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
const SLOT_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Loops and turns' };

function hintsUsed(round) {
  return round.dots.length + (round.shape ? 1 : 0);
}
const PEN_SPACING = 0.05;

function rounded(position) {
  return [Math.round(position.x * 100) / 100, Math.round(position.y * 100) / 100];
}

let currentUser = null;

const SEEN_HOW_TO_PLAY = 'seenHowToPlay';

function setUpHowToPlay() {
  const dialog = find('#how-to-play');
  const demo = find('#demo');
  const open = () => {
    dialog.showModal();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) demo.play().catch(() => {});
  };
  find('#open-how-to-play').addEventListener('click', open);
  find('#close-how-to-play').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => demo.pause());
  try {
    if (localStorage.getItem(SEEN_HOW_TO_PLAY)) return;
    localStorage.setItem(SEEN_HOW_TO_PLAY, 'yes');
  } catch {
    return;
  }
  open();
}

// With no connection, Endless makes and marks its own curve with the same maths the server uses.
// Endless never counts towards anything, so it does not matter that the answer is in the browser.
function offlineEndless() {
  const asked = Number(new URLSearchParams(location.search).get('slot'));
  const slot = [1, 2, 3, 4].includes(asked) ? asked : 1 + Math.floor(Math.random() * 3);
  const seed = 1 + Math.floor(Math.random() * 1999999999);
  const made = Curves.machineFromSeed(seed, slot);
  const machine = {
    ...made,
    family_name: Curves.FAMILIES[made.family_id].name,
    family_description: Curves.FAMILIES[made.family_id].description,
    extra_name: made.extra_family_id ? Curves.FAMILIES[made.extra_family_id].name : null
  };
  const game = {
    date: null,
    offline: true,
    limit: Curves.LIMIT,
    maxGoes: Curves.MAX_GOES,
    maxHints: Curves.MAX_HINTS,
    topScore: Curves.TOP_SCORE,
    goPenalty: Curves.GO_PENALTY,
    hintPenalty: Curves.HINT_PENALTY,
    shortestStroke: Curves.SHORTEST_STROKE,
    mostPoints: Curves.MOST_POINTS,
    curves: [{
      id: `r${seed}s${slot}`,
      slot,
      strokesPerGo: Curves.pieces(machine),
      ink: Curves.inkFor(machine),
      exits: Curves.exits(machine),
      saved: null
    }]
  };
  return { game, machine };
}

async function answerOffline(machine, url, body) {
  if (url.endsWith('/hint')) {
    if (!Number.isInteger(body.number) || body.number < 1 || body.number > Curves.MAX_HINTS) {
      throw new Error("You've used all your hints for this curve.");
    }
    return Curves.hintFor(machine, body.number);
  }
  const reply = Curves.markAttempt(body.drawing, machine, body.go, body.hints);
  if (reply.finished) {
    reply.formulaMath = katex.renderToString(reply.formula, { output: 'mathml', displayMode: true, throwOnError: false });
  }
  return reply;
}

async function playPage(endless) {
  setUpHowToPlay();
  const pastDate = endless ? null : new URLSearchParams(location.search).get('date');
  let address = '/api/today';
  if (endless) address = `/api/endless${location.search}`;
  if (pastDate) address = `/api/day/${encodeURIComponent(pastDate)}`;
  let game;
  let offlineMachine = null;
  try {
    game = await request(address);
  } catch (error) {
    if (!endless || !error.offline) throw error;
    ({ game, machine: offlineMachine } = offlineEndless());
  }
  const post = (url, body) => (offlineMachine ? answerOffline(offlineMachine, url, body) : send(url, body));
  const past = !endless && !game.today;
  const graph = find('#graph');
  const guestKey = endless || currentUser ? null : `guestRun:${game.date}`;
  const guestSaved = guestKey ? readStored(guestKey) || [] : [];

  const rounds = game.curves.map((curve) => {
    const saved = curve.saved || guestSaved.find((item) => item.id === curve.id);
    return {
      ...curve,
      strokes: [],
      inkSpent: 0,
      shown: saved && saved.last ? saved.last : null,
      ghost: null,
      missed: saved && saved.last ? saved.last.missed : [],
      missedRows: saved && saved.last && saved.last.missedRows ? saved.last.missedRows : [],
      shape: saved && saved.shape ? saved.shape : null,
      dots: saved ? saved.dots : [],
      goes: saved ? saved.goes : 0,
      history: saved && saved.history ? saved.history : [],
      result: saved ? saved.result : null
    };
  });
  let round = rounds.find((item) => !item.result) || rounds[rounds.length - 1];

  function saveGuestRun() {
    if (!guestKey) return;
    writeStored(guestKey, rounds.map((item) => ({
      id: item.id,
      goes: item.goes,
      dots: item.dots,
      history: item.history,
      result: item.result,
      shape: item.shape,
      last: item.shown ? { ...item.shown, missed: item.missed, missedRows: item.missedRows } : null
    })));
  }

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
      missedRows: round.missedRows,
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

  function flashPercent(value) {
    percent = value;
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

    const hintsLeft = game.maxHints - hintsUsed(round);
    find('#hint').disabled = hintsLeft === 0;
    let hintText = `Your first hint tells you what kind of curve this is and the next ones show you spots on it. Each costs ${game.hintPenalty} points (${hintsLeft} left).`;
    if (round.shape) hintText = `Another hint shows you a spot on the curve but costs ${game.hintPenalty} points (${hintsLeft} left).`;
    if (hintsLeft === 0) hintText = "You've used all your hints for this curve.";
    find('#hint-text').textContent = hintText;
    find('#hint-text').hidden = Boolean(round.result);
    find('#shape-text').textContent = round.shape || '';
    find('#shape-text').hidden = !round.shape || Boolean(round.result);

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
      const hints = hintsUsed(round);
      if (hints > 0) {
        lines.push(`${hints === 1 ? '1 hint' : `${hints} hints`}: −${hints * game.hintPenalty}`);
      }
      find('#result-working').replaceChildren(...lines.map((line) => element('li', line)));
      const keptBack = Boolean(result.keptBack);
      document.querySelectorAll('#result .answer').forEach((part) => { part.hidden = keptBack; });
      find('#result-kept').hidden = !keptBack;
      if (!keptBack) {
        find('#result-family').textContent = result.familyName;
        find('#result-formula').replaceChildren(mathNode(result.formulaMath));
      }

      const more = rounds.some((item) => !item.result);
      let nextLabel = 'Next curve';
      if (!more) nextLabel = summarySeen ? 'Back to your result' : 'See your result';
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
      const detail = `${item.result.familyName || 'Answer tomorrow'} · ${goesText(item.goes)}`
        + (hintsUsed(item) > 0 ? ` · ${hintsUsed(item) === 1 ? '1 hint' : `${hintsUsed(item)} hints`}` : '');
      row.append(
        element('span', SLOT_NAMES[item.slot], 'summary-name'),
        element('span', detail, 'summary-detail'),
        element('span', item.result.score, 'summary-score')
      );
      rows.append(row);
    });

    find('#save-prompt').hidden = Boolean(currentUser);
    if (!currentUser) {
      const pending = readStored(PENDING_RUN) || {};
      pending[game.date] = rounds.map((item) => ({ id: item.id, hints: hintsUsed(item), goes: item.history }));
      writeStored(PENDING_RUN, pending);
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
    percent = null;
    message('');
    showRound();
    find('#tabs').scrollIntoView({ block: 'nearest' });
    graph.focus({ preventScroll: true });
  });

  find('#copy-result').addEventListener('click', async () => {
    const date = new Date(`${game.date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });
    const scores = rounds.map((item) => `${SLOT_NAMES[item.slot]} ${item.result.score}`).join(' · ');
    const text = `Close Enough, ${date}\n${scores}\nTotal ${totalScore()}`;
    try {
      await navigator.clipboard.writeText(text);
      find('#copy-status').textContent = 'Copied.';
    } catch (_error) {
      find('#copy-status').textContent = text;
    }
  });

  find('#hint').addEventListener('click', async () => {
    if (waiting || round.result) return;
    waiting = true;
    const asking = round;
    try {
      const hint = await post(`/api/machines/${asking.id}/hint`, { number: hintsUsed(asking) + 1 });
      if (hint.shape) asking.shape = hint.shape;
      else asking.dots.push(hint.dot);
      saveGuestRun();
      showRound();
    } catch (error) {
      if (error.status === 409) return location.reload();
      message(error.message);
    } finally {
      waiting = false;
    }
  });

  function startStroke(position) {
    if (round.result || waiting) return false;
    beforeMarks = { shown: round.shown, ghost: round.ghost, missed: round.missed, missedRows: round.missedRows };
    if (round.strokes.length === 0 && round.shown) {
      round.ghost = round.shown;
      round.shown = null;
      round.missed = [];
      round.missedRows = [];
    }
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
      return message("You're out of ink. Lift your pen and it'll get marked.");
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
      round.missedRows = beforeMarks.missedRows;
      showGraph();
      if (round.strokes.length === 0 || !outOfInk()) {
        return message("That line was too short to count. Try a longer one.");
      }
    }
    if (round.strokes.length < round.strokesPerGo && !outOfInk()) {
      showGraph();
      return message(`That's piece ${round.strokes.length} of ${round.strokesPerGo}. Now draw the next one.`);
    }

    waiting = true;
    const marking = round;
    try {
      const result = await post(`/api/machines/${marking.id}/go`, {
        drawing: marking.strokes, go: marking.goes + 1, hints: hintsUsed(marking)
      });
      marking.goes += 1;
      marking.history.push(marking.strokes);
      marking.shown = { strokes: marking.strokes, levels: result.levels, nudges: result.nudges };
      marking.missed = result.missed;
      marking.missedRows = result.missedRows;
      if (result.finished) {
        marking.result = result;
        message('');
      } else {
        flashPercent(result.accuracy);
        const joined = result.levels.some((stroke) => stroke.includes(5));
        let advice = 'Trace over the green bits and fix the rest.';
        if (result.closeEnough) advice = "That's the right shape, just a bit out of place. Try drawing it closer.";
        find('#form-status').replaceChildren(element('strong', `${result.accuracy}%`, 'percent'), ` ${advice}`
          + (joined ? " The grey bit is where your line joins two pieces of the curve that aren't connected." : ''));
      }
      saveGuestRun();
    } catch (error) {
      if (error.status === 409) return location.reload();
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
    find('#today-date').textContent = round.slot === 4 ? SLOT_NAMES[4] : `${SLOT_NAMES[round.slot]} curve`;
    showRound();
    return;
  }

  const date = new Date(`${game.date}T00:00`);
  find('#today-date').textContent = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  if (past) showPastDay(date);
  showRound();
  if (!past) document.addEventListener('visibilitychange', async () => {
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
    const filtered = ['slot', 'family', 'status'].some((name) => choices.get(name));
    let count = `${rows.length} ${rows.length === 1 ? 'curve' : 'curves'}`;
    if (rows.length === 0) count = filtered ? 'No curves match these filters.' : "No curves yet. Finish one and it'll show up here.";
    find('#count').textContent = count;
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
  if (stats.bestDay) {
    const day = new Date(`${stats.bestDay.date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    find('#stat-best-day').replaceChildren(String(stats.bestDay.points), element('span', ` on ${day}`, 'figure-note'));
  } else {
    find('#stat-best-day').textContent = '–';
  }

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

function showPastDay(date) {
  const day = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });
  document.title = `${day} · Close Enough`;
  find('h1').textContent = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  find('#today-date').textContent = 'Past day';
  find('.intro').textContent = "These are the three curves from that day. They count towards your points and history, but not your day streak.";
  find('#summary-heading').textContent = `Your result for ${day}`;
  find('#summary-end').textContent = "That's all three done for this day.";
  find('nav a[href="/"]').removeAttribute('aria-current');
  find('nav a[href="/past.html"]').setAttribute('aria-current', 'page');
}

async function pastPage() {
  const { days } = await request('/api/days');
  const list = find('#days');
  days.forEach((day) => {
    const link = element('a', undefined, day.finished === 3 ? 'day done' : 'day');
    link.href = `/?date=${day.date}`;
    let note = 'Play';
    if (day.finished === 3) note = `Done · ${day.points} points`;
    else if (day.finished > 0) note = `Carry on · ${day.finished} of 3 done`;
    const name = new Date(`${day.date}T00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    link.append(element('span', name, 'day-name'), element('span', note, 'day-note'));
    const row = element('li');
    row.append(link);
    list.append(row);
  });
}

const PENDING_RUN = 'pendingRuns';

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the run is not kept, but the game still works.
  }
}

async function savePendingRun() {
  const pending = readStored(PENDING_RUN);
  if (!pending) return;
  localStorage.removeItem(PENDING_RUN);
  for (const [date, curves] of Object.entries(pending)) await savePendingDay(date, curves).catch(() => {});
}

async function savePendingDay(date, curves) {
  const day = await request(`/api/day/${encodeURIComponent(date)}`).catch(() => null);
  if (!day || day.curves.some((curve) => curve.saved)) return;

  for (const curve of curves) {
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
  past: pastPage,
  history: historyPage,
  stats: statsPage
};

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const me = await request('/api/me').catch((error) => {
    if (error.offline) return { user: null };
    throw error;
  });
  currentUser = me.user;
  if (currentUser) {
    find('#account-link').textContent = currentUser.display_name;
    await savePendingRun();
  }
  await pages[document.body.dataset.page]();
}

start().catch((error) => {
  if (!error.offline) return message(error.message);
  const endless = element('a', 'Endless');
  endless.href = '/endless.html';
  const note = element('p', undefined, 'offline-note');
  note.append("You're offline, and this page needs a connection. ", endless, ' still works offline, though.');
  find('main').classList.add('offline');
  find('main').prepend(note);
});
