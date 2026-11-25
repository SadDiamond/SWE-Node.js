const { all, run } = require('./db');

const LIMIT = 10;
const STEPS_PER_UNIT = 10;
const COLUMNS = 2 * LIMIT * STEPS_PER_UNIT + 1;

const MAX_GOES = 5;
const SOLVED_AT = 85;
const BANDS = [0.5, 1, 1.5, 2.5];
const SHORTEST_STROKE = 1.5;
const BIGGEST_STEP = 6;
const REACH = 30;
const NUDGE_FROM_LEVEL = 3;
const NUDGE_SPACING = 1.5;
const INK_TO_SPARE = 1.5;
const SMALLEST_INK = 30;
const SHARE_ON_SCREEN = 0.5;
const MOST_POINTS = 3000;
const DAYS_OF_HISTORY = 30;

const LINE = 1;
const PARABOLA = 2;
const V_SHAPE = 3;
const CUBIC = 4;
const WAVE = 5;
const CUBE_ROOT = 6;
const EXPONENTIAL = 7;
const HYPERBOLA = 8;
const SLANTED = 9;

function inputFor(column) {
  return column / STEPS_PER_UNIT - LIMIT;
}

function partValue(familyId, a, b, c, x) {
  switch (familyId) {
    case LINE:
      return (a / 2) * x + b;
    case PARABOLA:
      return (a / 4) * (x - b) ** 2 + c;
    case V_SHAPE:
      return (a / 2) * Math.abs(x - b) + c;
    case CUBIC:
      return (a / 16) * (x - b + c) * (x - b) * (x - b - c);
    case WAVE:
      return a * Math.sin((Math.PI * x) / b) + c;
    case CUBE_ROOT:
      return a * Math.cbrt(x - b) + c;
    case EXPONENTIAL:
      return a * 2 ** (x / b) + c;
    case HYPERBOLA:
      return x === b ? null : a / (x - b) + c;
    default:
      return x === b ? null : (c / 2) * x + a / (x - b);
  }
}

function evaluate(machine, x) {
  const main = partValue(machine.family_id, machine.a, machine.b, machine.c, x);
  if (main === null || !machine.extra_family_id) return main;

  const extra = partValue(machine.extra_family_id, machine.extra_a, machine.extra_b, machine.extra_c, x);
  return extra === null ? null : main + extra;
}

function visibleCurve(machine) {
  const curve = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    const output = evaluate(machine, inputFor(column));
    const onScreen = output !== null && Math.abs(output) <= LIMIT;
    curve.push(onScreen ? Math.round(output * 100) / 100 : null);
  }
  return curve;
}

function exits(machine) {
  const found = [];
  let before = null;

  for (let column = 0; column < COLUMNS; column += 1) {
    const output = evaluate(machine, inputFor(column));
    let now = 'on';
    if (output === null) now = 'none';
    else if (output > LIMIT) now = 'top';
    else if (output < -LIMIT) now = 'bottom';

    const offEdge = now === 'on' ? before : now;
    const crossed = before !== null && now !== before && (now === 'on' || before === 'on');
    if (crossed && (offEdge === 'top' || offEdge === 'bottom')) {
      found.push({ input: Math.round(inputFor(column) * 10) / 10, side: offEdge });
    }
    before = now;
  }
  return found;
}

function wholeCurve(machine) {
  const curve = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    curve.push(evaluate(machine, inputFor(column)));
  }
  return curve;
}

function closestOnPiece(x, y, x1, y1, x2, y2) {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  let along = lengthSquared === 0 ? 0 : ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared;
  along = Math.max(0, Math.min(1, along));
  return { x: x1 + along * (x2 - x1), y: y1 + along * (y2 - y1) };
}

function distanceToPiece(x, y, x1, y1, x2, y2) {
  const spot = closestOnPiece(x, y, x1, y1, x2, y2);
  return Math.hypot(x - spot.x, y - spot.y);
}

function nearestOnCurve(x, y, curve) {
  const nearest = Math.round((x + LIMIT) * STEPS_PER_UNIT);
  const first = Math.max(0, nearest - REACH);
  const last = Math.min(COLUMNS - 1, nearest + REACH);
  let best = { distance: Infinity, x: null, y: null };

  for (let column = first; column <= last; column += 1) {
    const here = curve[column];
    if (here === null) continue;
    const next = column < last ? curve[column + 1] : null;
    const joined = next !== null && Math.abs(next - here) <= BIGGEST_STEP;

    const spot = joined
      ? closestOnPiece(x, y, inputFor(column), here, inputFor(column + 1), next)
      : { x: inputFor(column), y: here };
    const distance = Math.hypot(x - spot.x, y - spot.y);
    if (distance < best.distance) best = { distance, ...spot };
  }
  return best;
}

function distanceToDrawing(x, y, strokes) {
  let best = Infinity;
  for (const stroke of strokes) {
    for (let index = 0; index < stroke.length - 1; index += 1) {
      const [x1, y1] = stroke[index];
      const [x2, y2] = stroke[index + 1];
      best = Math.min(best, distanceToPiece(x, y, x1, y1, x2, y2));
    }
  }
  return best;
}

function levelFor(distance) {
  const rounded = Math.round(distance * 100) / 100;
  const level = BANDS.findIndex((band) => rounded <= band);
  return level === -1 ? BANDS.length : level;
}

function judge(strokes, machine) {
  const whole = wholeCurve(machine);
  const visible = visibleCurve(machine);

  let inkLength = 0;
  let inkOnCurve = 0;
  const nudges = [];
  let sinceNudge = NUDGE_SPACING / 2;

  const levels = strokes.map((stroke) => stroke.map(([x, y], index) => {
    const spot = nearestOnCurve(x, y, whole);
    const level = levelFor(spot.distance);
    if (index > 0) {
      const [previousX, previousY] = stroke[index - 1];
      const length = Math.hypot(x - previousX, y - previousY);
      inkLength += length;
      inkOnCurve += length * (1 - level / BANDS.length);
      sinceNudge += length;
    }
    if (level >= NUDGE_FROM_LEVEL && sinceNudge >= NUDGE_SPACING && spot.distance < Infinity) {
      nudges.push({
        x,
        y,
        across: Math.round(((spot.x - x) / spot.distance) * 100) / 100,
        up: Math.round(((spot.y - y) / spot.distance) * 100) / 100
      });
      sinceNudge = 0;
    }
    return level;
  }));

  let curvePoints = 0;
  let curveCovered = 0;
  const missed = visible.map((output, column) => {
    if (output === null) return false;
    const level = levelFor(distanceToDrawing(inputFor(column), output, strokes));
    curvePoints += 1;
    curveCovered += 1 - level / BANDS.length;
    return level === BANDS.length;
  });

  const precision = inkLength === 0 ? 0 : inkOnCurve / inkLength;
  const coverage = curvePoints === 0 ? 0 : curveCovered / curvePoints;
  const accuracy = Math.round(((precision + coverage) / 2) * 100);
  return { levels, nudges, missed, accuracy, solved: accuracy >= SOLVED_AT };
}

function validDrawing(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > 10) return false;

  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) return false;
    points += stroke.length;
    for (const point of stroke) {
      const isPair = Array.isArray(point) && point.length === 2
        && point.every((value) => typeof value === 'number' && Math.abs(value) <= LIMIT);
      if (!isPair) return false;
    }
  }
  return points <= MOST_POINTS;
}

const MAX_HINTS = 3;

function hintDots(machine) {
  const visible = [];
  visibleCurve(machine).forEach((output, column) => {
    if (output !== null) visible.push([Math.round(inputFor(column) * 10) / 10, output]);
  });

  const dots = [];
  for (let index = 1; index <= MAX_HINTS; index += 1) {
    dots.push(visible[Math.floor((visible.length * index) / (MAX_HINTS + 1))]);
  }
  return [dots[1], dots[0], dots[2]];
}

function inkFor(machine) {
  const visible = visibleCurve(machine);
  let length = 0;
  for (let column = 1; column < COLUMNS; column += 1) {
    const here = visible[column];
    const before = visible[column - 1];
    if (here !== null && before !== null && Math.abs(here - before) <= BIGGEST_STEP) {
      length += Math.hypot(1 / STEPS_PER_UNIT, here - before);
    }
  }
  return Math.round(Math.max(SMALLEST_INK, length * INK_TO_SPARE));
}

function inkUsed(strokes) {
  let length = 0;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      length += Math.hypot(stroke[index][0] - stroke[index - 1][0], stroke[index][1] - stroke[index - 1][1]);
    }
  }
  return length;
}

function pieces(machine) {
  return 1 + asymptotes(machine).filter((line) => line.kind === 'vertical').length;
}

const TOP_SCORE = 1000;
const GO_PENALTY = 100;
const HINT_PENALTY = 150;

function scoreFor(accuracy, goes, hints) {
  const score = accuracy * (TOP_SCORE / 100) - GO_PENALTY * (goes - 1) - HINT_PENALTY * hints;
  return Math.max(0, Math.round(score));
}

function commonFactor(a, b) {
  return b === 0 ? Math.abs(a) : commonFactor(b, a % b);
}

function multiplier(top, bottom) {
  const factor = commonFactor(top, bottom);
  const sign = top < 0 ? '-' : '';
  const above = Math.abs(top) / factor;
  const below = bottom / factor;

  if (below === 1) return above === 1 ? sign : `${sign}${above}`;
  return `${sign}\\frac{${above}}{${below}}`;
}

function shifted(amount) {
  if (amount === 0) return 'x';
  return amount > 0 ? `x - ${amount}` : `x + ${-amount}`;
}

function plus(number) {
  if (number === 0) return '';
  return number > 0 ? ` + ${number}` : ` - ${-number}`;
}

function bracket(amount) {
  return amount === 0 ? 'x' : `(${shifted(amount)})`;
}

function expression(familyId, a, b, c) {
  switch (familyId) {
    case LINE:
      return `${multiplier(a, 2)}x${plus(b)}`;
    case PARABOLA:
      return `${multiplier(a, 4)}${bracket(b)}^2${plus(c)}`;
    case V_SHAPE:
      return `${multiplier(a, 2)}\\left|${shifted(b)}\\right|${plus(c)}`;
    case CUBIC:
      return `${multiplier(a, 16)}${bracket(b - c)}${bracket(b)}${bracket(b + c)}`;
    case WAVE:
      return `${multiplier(a, 1)}\\sin\\left(\\frac{\\pi x}{${b}}\\right)${plus(c)}`;
    case CUBE_ROOT:
      return `${multiplier(a, 1)}\\sqrt[3]{${shifted(b)}}${plus(c)}`;
    case EXPONENTIAL: {
      const size = Math.abs(b) === 1 ? 'x' : `\\frac{x}{${Math.abs(b)}}`;
      const power = `2^{${b < 0 ? '-' : ''}${size}}`;
      const front = Math.abs(a) === 1 ? multiplier(a, 1) : `${a} \\times `;
      return `${front}${power}${plus(c)}`;
    }
    case HYPERBOLA:
      return `${a < 0 ? '-' : ''}\\frac{${Math.abs(a)}}{${shifted(b)}}${plus(c)}`;
    default:
      return `${multiplier(c, 2)}x ${a > 0 ? '+' : '-'} \\frac{${Math.abs(a)}}{${shifted(b)}}`;
  }
}

function describe(machine) {
  const main = expression(machine.family_id, machine.a, machine.b, machine.c);
  if (!machine.extra_family_id) return `y = ${main}`;

  const extra = expression(machine.extra_family_id, machine.extra_a, machine.extra_b, machine.extra_c);
  return extra.startsWith('-') ? `y = ${main} - ${extra.slice(1)}` : `y = ${main} + ${extra}`;
}

function asymptotes(machine) {
  const { b, c } = machine;
  const lines = [];
  const hugsVertical = machine.family_id === HYPERBOLA || machine.family_id === SLANTED;
  if (hugsVertical) lines.push({ kind: 'vertical', input: b });

  let tilt = 0;
  if (machine.extra_family_id === LINE) tilt = machine.extra_a / 2;
  else if (machine.extra_family_id) return lines;

  if (machine.family_id === HYPERBOLA || machine.family_id === EXPONENTIAL) {
    lines.push({ kind: 'sloped', slope: tilt, start: c });
  }
  if (machine.family_id === SLANTED) {
    lines.push({ kind: 'sloped', slope: c / 2 + tilt, start: 0 });
  }
  return lines;
}

function numberMaker(seed) {
  let value = seed;
  return (limit) => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return Math.floor((value / 2147483648) * limit);
  };
}

function dayNumber(date) {
  return Math.floor(Date.parse(date) / 86400000);
}

function todayDate() {
  return new Date().toLocaleDateString('en-CA');
}

function randomMachine(next, familyId) {
  const between = (low, high) => low + next(high - low + 1);
  const nonZero = (low, high) => {
    let value = 0;
    while (value === 0) value = between(low, high);
    return value;
  };
  const pick = (choices) => choices[next(choices.length)];

  switch (familyId) {
    case LINE:
      return { a: nonZero(-6, 6), b: between(-6, 6), c: 0 };
    case PARABOLA:
      return { a: pick([-4, -2, -1, 1, 2, 4]), b: between(-5, 5), c: between(-8, 8) };
    case V_SHAPE:
      return { a: nonZero(-4, 4), b: between(-5, 5), c: between(-6, 6) };
    case CUBIC:
      return { a: nonZero(-3, 3), b: between(-3, 3), c: pick([4, 5]) };
    case WAVE:
      return { a: between(1, 5), b: between(2, 5), c: between(-4, 4) };
    case CUBE_ROOT:
      return { a: nonZero(-3, 3), b: between(-5, 5), c: between(-5, 5) };
    case EXPONENTIAL:
      return { a: nonZero(-3, 3), b: nonZero(-3, 3), c: between(-6, 6) };
    case HYPERBOLA:
      return { a: nonZero(-6, 6), b: between(-5, 5), c: between(-5, 5) };
    default:
      return { a: pick([-6, -4, -2, 2, 4, 6]), b: between(-4, 4), c: pick([-2, -1, 1, 2]) };
  }
}

const RECIPES_FOR_SLOT = {
  1: [[LINE], [PARABOLA], [V_SHAPE]],
  2: [[CUBIC], [WAVE], [CUBE_ROOT], [EXPONENTIAL],
    [LINE, WAVE], [PARABOLA, WAVE], [V_SHAPE, LINE], [CUBE_ROOT, LINE]],
  3: [[HYPERBOLA], [SLANTED],
    [HYPERBOLA, PARABOLA], [HYPERBOLA, WAVE], [HYPERBOLA, V_SHAPE], [CUBIC, WAVE], [EXPONENTIAL, LINE]]
};

function randomExtra(next, familyId) {
  const between = (low, high) => low + next(high - low + 1);
  const pick = (choices) => choices[next(choices.length)];

  switch (familyId) {
    case LINE:
      return { extra_a: pick([-3, -2, -1, 1, 2, 3]), extra_b: 0, extra_c: 0 };
    case WAVE:
      return { extra_a: between(1, 2), extra_b: between(2, 4), extra_c: 0 };
    case PARABOLA:
      return { extra_a: pick([-1, 1]), extra_b: between(-3, 3), extra_c: 0 };
    default:
      return { extra_a: pick([-2, -1, 1, 2]), extra_b: between(-3, 3), extra_c: 0 };
  }
}

function makeMachine(date, slot) {
  const next = numberMaker(dayNumber(date) * 7919 + slot * 104729);
  const recipes = RECIPES_FOR_SLOT[slot];
  const [familyId, extraFamilyId] = recipes[next(recipes.length)];

  let machine;
  let onScreen = 0;
  while (onScreen < COLUMNS * SHARE_ON_SCREEN) {
    machine = {
      family_id: familyId,
      ...randomMachine(next, familyId),
      extra_family_id: null,
      extra_a: null,
      extra_b: null,
      extra_c: null
    };
    if (extraFamilyId) {
      machine = { ...machine, extra_family_id: extraFamilyId, ...randomExtra(next, extraFamilyId) };
    }
    onScreen = visibleCurve(machine).filter((output) => output !== null).length;
  }
  return machine;
}

const MACHINE_SELECT = `
  SELECT machines.*, families.name AS family_name, families.difficulty, extras.name AS extra_name
  FROM machines
  INNER JOIN families ON families.id = machines.family_id
  LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
`;

function kindName(machine) {
  return machine.extra_name
    ? `${machine.family_name} + ${machine.extra_name.toLowerCase()}`
    : machine.family_name;
}

async function machinesFor(date) {
  for (const slot of [1, 2, 3]) {
    const made = makeMachine(date, slot);
    await run(
      `INSERT OR IGNORE INTO machines
         (play_date, slot, family_id, a, b, c, extra_family_id, extra_a, extra_b, extra_c)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, slot, made.family_id, made.a, made.b, made.c,
        made.extra_family_id, made.extra_a, made.extra_b, made.extra_c]
    );
  }
  return all(`${MACHINE_SELECT} WHERE machines.play_date = ? ORDER BY machines.slot`, [date]);
}

async function fillHistory() {
  const today = dayNumber(todayDate());
  for (let day = today - DAYS_OF_HISTORY; day <= today; day += 1) {
    await machinesFor(new Date(day * 86400000).toISOString().slice(0, 10));
  }
}

module.exports = {
  COLUMNS, GO_PENALTY, HINT_PENALTY, MACHINE_SELECT, LIMIT, MAX_GOES, MAX_HINTS, MOST_POINTS, TOP_SCORE, SHORTEST_STROKE, STEPS_PER_UNIT,
  LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, CUBE_ROOT, EXPONENTIAL, HYPERBOLA, SLANTED,
  asymptotes, describe, evaluate, exits, fillHistory, inputFor, judge, machinesFor, makeMachine,
  hintDots, inkFor, inkUsed, kindName, pieces, scoreFor, todayDate, validDrawing, visibleCurve, wholeCurve
};
