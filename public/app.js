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

function goesText(count) {
  return count === 1 ? '1 attempt' : `${count} attempts`;
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error("You're offline, and this needs a connection to the server.");
  }

  const isJson = (response.headers.get('Content-Type') || '').includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'Something went wrong, so try that again.');
  return data;
}

function send(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const SLOT_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const PEN_SPACING = 0.05;

function rounded(position) {
  return [Math.round(position.x * 100) / 100, Math.round(position.y * 100) / 100];
}

async function start() {
  const game = await request('/api/today');
  const graph = find('#graph');

  const rounds = game.curves.map((curve) => ({
    ...curve,
    strokes: [],
    shown: null,
    ghost: null,
    missed: [],
    dots: [],
    goes: 0,
    result: null
  }));
  let round = rounds[0];

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

  let drawQueued = false;
  function showGraphSoon() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      showGraph();
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

  function totalScore() {
    return rounds.reduce((total, item) => total + (item.result ? item.result.score : 0), 0);
  }

  let totalOnScreen = 0;
  function showTotal() {
    countUp(find('#total'), totalOnScreen, totalScore());
    totalOnScreen = totalScore();
  }

  function showProgress() {
    const list = find('#tabs');
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
      const step = element('li', undefined, `tab ${state}`);
      step.append(element('span', `${item.slot}. ${SLOT_NAMES[item.slot]}`), element('span', note, 'tab-score'));
      if (state === 'current') step.setAttribute('aria-current', 'step');
      list.append(step);
    });
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
      : `Each hint shows a spot on the curve and costs ${game.hintPenalty} points (${hintsLeft} left).`;
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
      find('#result-heading').textContent = result.solved
        ? `Cracked it in ${goesText(round.goes)}`
        : 'Out of attempts';
      find('#result-top').textContent = `/ ${game.topScore}`;
      countUp(find('#result-score'), 0, result.score);
      showTotal();

      const extraGoes = round.goes - 1;
      const lines = [`${result.accuracy}% accurate: ${result.accuracy * (game.topScore / 100)}`];
      if (extraGoes > 0) lines.push(`${goesText(extraGoes).replace('attempt', 'extra attempt')}: −${extraGoes * game.goPenalty}`);
      if (round.dots.length > 0) {
        lines.push(`${round.dots.length === 1 ? '1 hint' : `${round.dots.length} hints`}: −${round.dots.length * game.hintPenalty}`);
      }
      find('#result-working').replaceChildren(...lines.map((line) => element('li', line)));
      find('#result-family').textContent = result.familyName;
      find('#result-formula').textContent = result.formula;

      const more = rounds.some((item) => !item.result);
      find('#next-curve').textContent = more ? 'Next curve' : 'See your result';
    }
    showProgress();
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

    find('.layout').classList.add('ended');
    find('#summary').hidden = false;
    countUp(find('#summary-total'), 0, totalScore());
    find('#summary-heading').focus();
  }

  find('#next-curve').addEventListener('click', () => {
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

    stroke.push(rounded(position));
    strokeLength += moved;
    showGraphSoon();
  }

  async function endStroke() {
    if (strokeLength < game.shortestStroke) {
      round.strokes.pop();
      round.shown = beforeMarks.shown;
      round.ghost = beforeMarks.ghost;
      round.missed = beforeMarks.missed;
      showGraph();
      return message('That line was too short to count, so try drawing a longer one.');
    }
    if (round.strokes.length < round.strokesPerGo) {
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
    waiting = false;
    showRound();
  }

  let drawing = false;
  graph.addEventListener('pointerdown', (event) => {
    pen.visible = false;
    drawing = startStroke(graphPosition(graph, event, game.limit));
    if (drawing) graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (drawing) extendStroke(graphPosition(graph, event, game.limit));
  });
  function liftPointer() {
    if (!drawing) return;
    drawing = false;
    endStroke();
  }
  graph.addEventListener('pointerup', liftPointer);
  graph.addEventListener('pointercancel', liftPointer);

  graph.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] };

    if (event.key === ' ') {
      event.preventDefault();
      if (pen.down) {
        pen.down = false;
        endStroke();
      } else if (startStroke(pen)) {
        pen.down = true;
        message('Your pen is down, so move it with the arrow keys and press Space to lift it.');
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

  const date = new Date(`${game.date}T00:00`);
  find('#today-date').textContent = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  showRound();
}

start().catch((error) => message(error.message));
