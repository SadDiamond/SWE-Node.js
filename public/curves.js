// The maths of the game: making curves, drawing them out and marking drawings.
// It runs on the server and, for offline play, in the browser, so it uses nothing from either.
(function share(publish) {
const LIMIT = 10;
const STEPS_PER_UNIT = 10;
const COLUMNS = 2 * LIMIT * STEPS_PER_UNIT + 1;

const MAX_GOES = 5;
const SOLVED_AT = 85;
const BANDS = [0.6, 1.25, 1.9, 2.6];
const SHORTEST_STROKE = 1.5;
const REACH = 10;
const SHAPE_SHIFTS = [-2, -1, 0, 1, 2];
const SHAPE_SIZES = [0.85, 1, 1.15];
const SHAPE_FLOOR = 30;
const SHAPE_TOLERANCE = 0.4;
const FINE_SHIFTS = [-0.5, -0.25, 0, 0.25, 0.5];
const NUDGE_FROM_LEVEL = 3;
const NUDGE_SPACING = 1.5;
const INK_TO_SPARE = 1.5;
const SMALLEST_INK = 30;
const SHARE_ON_SCREEN = 0.5;
// A line that crosses a vertical asymptote is greyed out this far either side of it.
const CROSSING_ZONE = 0.5;
const CROSSED = 5;
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
const BELL = 10;
const S_CURVE = 11;
const QUARTIC = 12;
const INVERSE_SQUARE = 13;
const TANGENT = 14;
const CIRCLE = 15;
const ELLIPSE = 16;
const SIDEWAYS = 17;
const DIAMOND = 18;
const ROUNDED_SQUARE = 19;
const SIDEWAYS_V = 20;
const SIDEWAYS_HYPERBOLA = 21;
const UPRIGHT_HYPERBOLA = 22;
const RELATIONS = [CIRCLE, ELLIPSE, SIDEWAYS, DIAMOND, ROUNDED_SQUARE, SIDEWAYS_V, SIDEWAYS_HYPERBOLA, UPRIGHT_HYPERBOLA];
const TWO_PIECE_RELATIONS = [SIDEWAYS_HYPERBOLA, UPRIGHT_HYPERBOLA];

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
    case BELL:
      return a * 2 ** (-((x - b) ** 2) / c);
    case S_CURVE:
      return a / (1 + 2 ** (b - x)) + c;
    case QUARTIC:
      return (a / 64) * ((x - b) ** 2 - c * c) ** 2;
    case INVERSE_SQUARE:
      return x === b ? null : a / (x - b) ** 2 + c;
    case TANGENT:
      return Math.abs(Math.cos((Math.PI * x) / b)) < 1e-9 ? null : a * Math.tan((Math.PI * x) / b) + c;
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

function visibleBranch(whole) {
  const onGraph = (output) => output !== null && output !== undefined && Math.abs(output) <= LIMIT;

  return whole.map((output, column) => {
    if (output === null) return null;
    if (onGraph(output)) return Math.round(output * 100) / 100;
    const besideGraph = onGraph(whole[column - 1]) || onGraph(whole[column + 1]);
    return besideGraph ? Math.sign(output) * LIMIT : null;
  });
}

function visibleCurve(machine) {
  return visibleBranch(wholeCurve(machine));
}

function visibleBranches(machine) {
  return wholeBranches(machine).map(visibleBranch);
}

function stopsShort(machine) {
  const whole = wholeCurve(machine);
  const onGraph = (output) => output !== null && output !== undefined && Math.abs(output) <= LIMIT;
  return whole.some((output, column) => output === null
    && (onGraph(whole[column - 1]) || onGraph(whole[column + 1])));
}

function exits(machine) {
  const found = [];
  for (const whole of wholeBranches(machine)) {
    let before = null;
    for (let column = 0; column < COLUMNS; column += 1) {
      const output = whole[column];
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
    for (const [column, side] of [[0, 'left'], [COLUMNS - 1, 'right']]) {
      const output = whole[column];
      if (output !== null && Math.abs(output) <= LIMIT) found.push({ output: Math.round(output * 10) / 10, side });
    }
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

function isRelation(machine) {
  return RELATIONS.includes(machine.family_id);
}

// A relation such as a circle has two outputs for most inputs, so it is split into two
// branches (top and bottom, or upper and lower arm). Each branch has at most one output per input.
function relationSpread(machine, x) {
  const { a, b, c } = machine;
  if (machine.family_id === CIRCLE) {
    const left = a * a - (x - b) ** 2;
    return left < 0 ? null : { middle: c, spread: Math.sqrt(left) };
  }
  if (machine.family_id === ELLIPSE) {
    const left = 1 - ((x - b) / a) ** 2;
    return left < 0 ? null : { middle: c, spread: machine.d * Math.sqrt(left) };
  }
  if (machine.family_id === DIAMOND) {
    const left = 1 - Math.abs(x - b) / a;
    return left < 0 ? null : { middle: c, spread: machine.d * left };
  }
  if (machine.family_id === ROUNDED_SQUARE) {
    const left = a ** 4 - (x - b) ** 4;
    return left < 0 ? null : { middle: c, spread: left ** 0.25 };
  }
  if (machine.family_id === SIDEWAYS_V) {
    const left = (2 * (x - b)) / a;
    return left < 0 ? null : { middle: c, spread: left };
  }
  if (machine.family_id === SIDEWAYS_HYPERBOLA) {
    const left = ((x - b) / a) ** 2 - 1;
    return left < 0 ? null : { middle: c, spread: machine.d * Math.sqrt(left) };
  }
  if (machine.family_id === UPRIGHT_HYPERBOLA) {
    return { middle: c, spread: machine.d * Math.sqrt(1 + ((x - b) / a) ** 2) };
  }
  const left = (4 * (x - b)) / a;
  return left < 0 ? null : { middle: c, spread: Math.sqrt(left) };
}

function wholeBranches(machine) {
  if (!isRelation(machine)) return [wholeCurve(machine)];
  const upper = [];
  const lower = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    const found = relationSpread(machine, inputFor(column));
    upper.push(found ? found.middle + found.spread : null);
    lower.push(found ? found.middle - found.spread : null);
  }
  return [upper, lower];
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

// Measuring straight up and down would be unfair on steep curves, where being a little
// to one side looks like a huge error.
// Only the branch on the point's own side of every vertical asymptote counts: the curve never
// crosses one, so being near the other branch is not being near the curve.
function nearestOnCurve(x, y, branches, walls) {
  const nearest = Math.round((x + LIMIT) * STEPS_PER_UNIT);
  const first = Math.max(0, nearest - REACH);
  const last = Math.min(COLUMNS - 1, nearest + REACH);
  let best = { distance: Infinity, x: null, y: null };

  for (const curve of branches) {
    for (let column = first; column <= last; column += 1) {
      const here = curve[column];
      if (here === null || sideOf(inputFor(column), walls) !== sideOf(x, walls)) continue;
      const next = column < last ? curve[column + 1] : null;

      const spot = next !== null
        ? closestOnPiece(x, y, inputFor(column), here, inputFor(column + 1), next)
        : { x: inputFor(column), y: here };
      const distance = Math.hypot(x - spot.x, y - spot.y);
      if (distance < best.distance) best = { distance, ...spot };
    }
  }
  return best;
}

function sideOf(x, walls) {
  return walls.filter((wall) => wall < x).length;
}

// A piece of drawing only covers the curve if it runs roughly the same way as the curve there.
// A line cutting straight across a steep slope passes close to it but does not follow it.
// This is how closely the two directions must line up (the cosine of about 55 degrees).
const SAME_WAY = 0.57;

// The way each piece of a drawing runs, smoothed over a few pen positions so hand wobble does not count.
function directionsOf(strokes) {
  return strokes.map((stroke) => stroke.map((_point, index) => {
    const [x1, y1] = stroke[Math.max(0, index - 3)];
    const [x2, y2] = stroke[Math.min(stroke.length - 1, index + 4)];
    const length = Math.hypot(x2 - x1, y2 - y1);
    return length === 0 ? null : [(x2 - x1) / length, (y2 - y1) / length];
  }));
}

// The way the curve runs just to the left and just to the right of a column, so a sharp
// corner (like the point of a V) accepts a line coming along either arm.
function tangentsAt(whole, column) {
  const way = (from, to) => {
    if (whole[from] === null || whole[from] === undefined || whole[to] === null || whole[to] === undefined) return null;
    const rise = whole[to] - whole[from];
    const length = Math.hypot(1 / STEPS_PER_UNIT, rise);
    return [1 / STEPS_PER_UNIT / length, rise / length];
  };
  return [way(column - 1, column), way(column, column + 1)].filter(Boolean);
}

// Files every piece of a drawing under the squares of the graph it passes through. A square is as
// wide as the furthest a drawing can be from the curve and still earn anything, so a point only
// ever needs to look at the pieces in its own square and the eight around it.
const SQUARE = BANDS[BANDS.length - 1];

const squareKey = (across, up) => (across + 100) * 1000 + up + 100;

// Each piece is stored as [x1, y1, x2, y2, side, direction]: its ends, which gap between vertical
// asymptotes it is in (null if it crosses one) and which way it runs.
function filePieces(strokes, walls) {
  const squares = new Map();
  const directions = directionsOf(strokes);
  strokes.forEach((stroke, strokeIndex) => {
    for (let index = 0; index < stroke.length - 1; index += 1) {
      const [x1, y1] = stroke[index];
      const [x2, y2] = stroke[index + 1];
      const side = sideOf(x1, walls) === sideOf(x2, walls) ? sideOf(x1, walls) : null;
      const piece = [x1, y1, x2, y2, side, directions[strokeIndex][index]];
      for (let across = Math.floor(Math.min(x1, x2) / SQUARE); across <= Math.floor(Math.max(x1, x2) / SQUARE); across += 1) {
        for (let up = Math.floor(Math.min(y1, y2) / SQUARE); up <= Math.floor(Math.max(y1, y2) / SQUARE); up += 1) {
          const key = squareKey(across, up);
          if (!squares.has(key)) squares.set(key, []);
          squares.get(key).push(piece);
        }
      }
    }
  });
  return squares;
}

function distanceToDrawing(x, y, side, tangents, squares) {
  let best = Infinity;
  const across = Math.floor(x / SQUARE);
  const up = Math.floor(y / SQUARE);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const pieces = squares.get(squareKey(across + dx, up + dy));
      if (!pieces) continue;
      for (const [x1, y1, x2, y2, pieceSide, way] of pieces) {
        if (pieceSide !== side) continue;
        if (way && tangents.length > 0) {
          let sameWay = false;
          for (const [alongX, alongY] of tangents) {
            if (Math.abs(way[0] * alongX + way[1] * alongY) >= SAME_WAY) sameWay = true;
          }
          if (!sameWay) continue;
        }
        const distance = distanceToPiece(x, y, x1, y1, x2, y2);
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

function levelFor(distance) {
  // Rounded so that tiny decimal errors do not push a point into the next band.
  const rounded = Math.round(distance * 100) / 100;
  const level = BANDS.findIndex((band) => rounded <= band);
  return level === -1 ? BANDS.length : level;
}

const LOOPS = [CIRCLE, ELLIPSE, DIAMOND, ROUNDED_SQUARE];
const MATCH_POINTS = 120;

function resample(points, count) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = lengths[lengths.length - 1];
  const samples = [];
  let segment = 1;
  for (let step = 0; step < count; step += 1) {
    const wanted = (total * step) / count;
    while (segment < points.length - 1 && lengths[segment] < wanted) segment += 1;
    const span = lengths[segment] - lengths[segment - 1] || 1;
    const along = (wanted - lengths[segment - 1]) / span;
    const [x1, y1] = points[segment - 1];
    const [x2, y2] = points[segment];
    samples.push([x1 + (x2 - x1) * along, y1 + (y2 - y1) * along]);
  }
  return { samples, lengths, total };
}

// When a loop is drawn as a loop, each part of the drawing is paired with the part of the real
// loop it stands for (top with top, bottom with bottom). The colours, the score and the arrows
// then judge each part only against its partner. Judging against the nearest part of the curve
// instead would call the bottom of a squashed loop "on the curve" because it is near the top.
const MATCH_WINDOW = 12;

function loopMatch(stroke, machine) {
  if (!LOOPS.includes(machine.family_id) || stroke.length < 3) return null;
  const drawn = resample(stroke, MATCH_POINTS);
  const [startX, startY] = stroke[0];
  const [endX, endY] = stroke[stroke.length - 1];
  if (drawn.total === 0 || Math.hypot(endX - startX, endY - startY) > drawn.total / 4) return null;

  const [upper, lower] = visibleBranches(machine).map((branch) => branch
    .map((output, column) => (output === null ? null : [inputFor(column), output]))
    .filter(Boolean));
  const outlinePoints = [...upper, ...lower.reverse()];
  const outline = resample([...outlinePoints, outlinePoints[0]], MATCH_POINTS).samples;
  const wrap = (step) => ((step % MATCH_POINTS) + MATCH_POINTS) % MATCH_POINTS;

  let best = { cost: Infinity, shift: 0, turn: 1 };
  for (const turn of [1, -1]) {
    for (let shift = 0; shift < MATCH_POINTS; shift += 1) {
      let cost = 0;
      for (let step = 0; step < MATCH_POINTS; step += 1) {
        const [x1, y1] = drawn.samples[step];
        const [x2, y2] = outline[wrap(shift + turn * step)];
        cost += Math.hypot(x2 - x1, y2 - y1);
      }
      if (cost < best.cost) best = { cost, shift, turn };
    }
  }
  return {
    outline,
    drawn: drawn.samples,
    partnerOfPen: (index) => wrap(best.shift + best.turn * Math.round((drawn.lengths[index] / drawn.total) * MATCH_POINTS)),
    partnerOfOutline: (step) => wrap(best.turn * (step - best.shift))
  };
}

function distanceNear(x, y, points, centre) {
  let best = Infinity;
  for (let offset = -MATCH_WINDOW; offset <= MATCH_WINDOW; offset += 1) {
    const [x1, y1] = points[(((centre + offset) % MATCH_POINTS) + MATCH_POINTS) % MATCH_POINTS];
    const [x2, y2] = points[(((centre + offset + 1) % MATCH_POINTS) + MATCH_POINTS) % MATCH_POINTS];
    best = Math.min(best, distanceToPiece(x, y, x1, y1, x2, y2));
  }
  return best;
}

// The points the curve is checked at to see how much of it a drawing covers. They are spaced
// evenly along the curve's length rather than across the graph, so a steep stretch counts as much
// as a flat stretch of the same length.
function curveSamples(whole, visible) {
  const gap = 1 / STEPS_PER_UNIT;
  const samples = [];
  visible.forEach((branch, branchIndex) => branch.forEach((output, column) => {
    if (output === null) return;
    samples.push({ x: inputFor(column), y: output, tangents: tangentsAt(whole[branchIndex], column) });
    const next = branch[column + 1];
    if (next === null || next === undefined) return;
    const rise = next - output;
    const length = Math.hypot(gap, rise);
    const steps = Math.ceil(length / gap);
    const way = [[gap / length, rise / length]];
    for (let step = 1; step < steps; step += 1) {
      samples.push({ x: inputFor(column) + (gap * step) / steps, y: output + (rise * step) / steps, tangents: way });
    }
  }));
  return samples;
}

// How much of the curve a drawing covers, from 0 to 1, and where it was missed altogether.
function coverageOf(strokes, whole, visible, walls) {
  const squares = filePieces(strokes, walls);
  const missed = new Array(COLUMNS).fill(false);
  const missedRows = new Array(COLUMNS).fill(false);
  const samples = curveSamples(whole, visible);
  let covered = 0;
  for (const { x, y, tangents } of samples) {
    const level = levelFor(distanceToDrawing(x, y, sideOf(x, walls), tangents, squares));
    covered += 1 - level / BANDS.length;
    if (level === BANDS.length) {
      missed[Math.round((x + LIMIT) * STEPS_PER_UNIT)] = true;
      missedRows[Math.round((y + LIMIT) * STEPS_PER_UNIT)] = true;
    }
  }
  return { coverage: samples.length === 0 ? 0 : covered / samples.length, missed, missedRows };
}

function judge(strokes, machine) {
  const whole = wholeBranches(machine);
  const visible = whole.map(visibleBranch);
  const walls = asymptotes(machine).filter((line) => line.kind === 'vertical').map((line) => line.input);

  let inkLength = 0;
  let inkOnCurve = 0;
  const nudges = [];
  let sinceNudge = NUDGE_SPACING / 2;

  const match = strokes.length === 1 ? loopMatch(strokes[0], machine) : null;
  const levels = strokes.map((stroke) => {
    const crossedWalls = walls.filter((wall) => stroke.some(([x], index) => index > 0
      && sideOf(stroke[index - 1][0], [wall]) !== sideOf(x, [wall])));
    return stroke.map(([x, y], index) => {
      const spot = nearestOnCurve(x, y, whole, walls);
      const partner = match ? match.partnerOfPen(index) : null;
      const level = levelFor(match ? distanceNear(x, y, match.outline, partner) : spot.distance);
      const crossing = (index > 0 && sideOf(stroke[index - 1][0], walls) !== sideOf(x, walls))
        || crossedWalls.some((wall) => Math.abs(x - wall) <= CROSSING_ZONE);
      if (index > 0) {
        const [previousX, previousY] = stroke[index - 1];
        const length = Math.hypot(x - previousX, y - previousY);
        inkLength += length;
        inkOnCurve += length * (1 - (crossing ? BANDS.length : level) / BANDS.length);
        sinceNudge += length;
      }
      if (crossing) return CROSSED;
      const aim = match ? { x: match.outline[partner][0], y: match.outline[partner][1] } : spot;
      const away = Math.hypot(aim.x - x, aim.y - y);
      if (level >= NUDGE_FROM_LEVEL && sinceNudge >= NUDGE_SPACING && away > 0 && away < Infinity) {
        nudges.push({
          x,
          y,
          across: Math.round(((aim.x - x) / away) * 100) / 100,
          up: Math.round(((aim.y - y) / away) * 100) / 100
        });
        sinceNudge = 0;
      }
      return level;
    });
  });

  let curvePoints = 0;
  let curveCovered = 0;
  let missed = new Array(COLUMNS).fill(false);
  let missedRows = new Array(COLUMNS).fill(false);
  let coverage = 0;
  const rowFor = (output) => Math.round((output + LIMIT) * STEPS_PER_UNIT);
  if (match) {
    let before = null;
    match.outline.forEach(([outlineX, outlineY], step) => {
      const level = levelFor(distanceNear(outlineX, outlineY, match.drawn, match.partnerOfOutline(step)));
      curvePoints += 1;
      curveCovered += 1 - level / BANDS.length;
      if (level < BANDS.length) {
        before = null;
        return;
      }
      const [fromX, fromY] = before || [outlineX, outlineY];
      for (let column = rowFor(Math.min(fromX, outlineX)); column <= rowFor(Math.max(fromX, outlineX)); column += 1) {
        missed[column] = true;
      }
      for (let row = rowFor(Math.min(fromY, outlineY)); row <= rowFor(Math.max(fromY, outlineY)); row += 1) {
        missedRows[row] = true;
      }
      before = [outlineX, outlineY];
    });
    coverage = curvePoints === 0 ? 0 : curveCovered / curvePoints;
  } else {
    ({ coverage, missed, missedRows } = coverageOf(strokes, whole, visible, walls));
  }

  const precision = inkLength === 0 ? 0 : inkOnCurve / inkLength;
  const accuracy = Math.round(((precision + coverage) / 2) * 100);

  const closeEnough = accuracy < SOLVED_AT && accuracy >= SHAPE_FLOOR && rightShape(strokes, whole, visible, walls);
  return { levels, nudges, missed, missedRows, accuracy, closeEnough, solved: accuracy >= SOLVED_AT };
}

function accuracyOf(strokes, whole, visible, walls) {
  let inkLength = 0;
  let inkOnCurve = 0;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      const [x, y] = stroke[index];
      const length = Math.hypot(x - stroke[index - 1][0], y - stroke[index - 1][1]);
      inkLength += length;
      if (sideOf(stroke[index - 1][0], walls) !== sideOf(x, walls)) continue;
      inkOnCurve += length * (1 - levelFor(nearestOnCurve(x, y, whole, walls).distance) / BANDS.length);
    }
  }

  const { coverage } = coverageOf(strokes, whole, visible, walls);
  const precision = inkLength === 0 ? 0 : inkOnCurve / inkLength;
  return ((precision + coverage) / 2) * 100;
}

function curveLength(visible) {
  let length = 0;
  for (const branch of visible) {
    for (let column = 1; column < branch.length; column += 1) {
      if (branch[column] === null || branch[column - 1] === null) continue;
      length += Math.hypot(inputFor(column) - inputFor(column - 1), branch[column] - branch[column - 1]);
    }
  }
  return length;
}

// Each check below is cheaper than the next, so most drawings are ruled out before the slow one.
function rightShape(strokes, whole, visible, walls) {
  if (inkUsed(strokes) * SHAPE_SIZES[SHAPE_SIZES.length - 1] < curveLength(visible) * 0.5) return false;
  const light = strokes.map((stroke) => stroke.filter((_point, index) => index % 4 === 0 || index === stroke.length - 1));
  const points = light.flat();
  const middleX = (Math.min(...points.map(([x]) => x)) + Math.max(...points.map(([x]) => x))) / 2;
  const middleY = (Math.min(...points.map(([, y]) => y)) + Math.max(...points.map(([, y]) => y))) / 2;

  for (const scale of SHAPE_SIZES) {
    for (const across of SHAPE_SHIFTS) {
      for (const up of SHAPE_SHIFTS) {
        const moved = light.map((stroke) => stroke.map(([x, y]) => [
          middleX + (x - middleX) * scale + across,
          middleY + (y - middleY) * scale + up
        ]));
        if (followsClosely(moved, whole, walls) && accuracyOf(moved, whole, visible, walls) >= SOLVED_AT) return true;
      }
    }
  }
  return false;
}

// The marking bands are generous, so a smooth bend can pass for a sharp corner. Once moved into
// place, nearly all of a drawing of the right shape should hug the curve far more tightly than that.
function followsClosely(strokes, whole, walls) {
  const points = strokes.flat();
  const tightest = (across, up) => {
    const distances = points.map(([x, y]) => nearestOnCurve(x + across, y + up, whole, walls).distance).sort((a, b) => a - b);
    return distances[Math.floor(distances.length * 0.9)];
  };
  // Nudging by at most half a unit each way moves every point less than 0.75, so a drawing
  // further off than this can be ruled out without trying every nudge.
  if (tightest(0, 0) > SHAPE_TOLERANCE + 0.75) return false;
  for (const across of FINE_SHIFTS) {
    for (const up of FINE_SHIFTS) {
      if (tightest(across, up) <= SHAPE_TOLERANCE) return true;
    }
  }
  return false;
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

// The page never records pen positions closer together than this, so anything closer was sent some
// other way. Dropping those points stops a drawing padded with thousands of repeats from being slow to mark.
const THINNEST = 0.04;

function thinned(strokes) {
  return strokes.map((stroke) => {
    const kept = [stroke[0]];
    for (const point of stroke.slice(1, -1)) {
      const [lastX, lastY] = kept[kept.length - 1];
      if (Math.hypot(point[0] - lastX, point[1] - lastY) >= THINNEST) kept.push(point);
    }
    return [...kept, stroke[stroke.length - 1]];
  });
}

const MAX_HINTS = 3;

function hintDots(machine) {
  const visible = [];
  visibleBranches(machine).forEach((branch, index) => {
    const points = [];
    branch.forEach((output, column) => {
      if (output !== null) points.push([Math.round(inputFor(column) * 10) / 10, output]);
    });
    visible.push(...(index % 2 === 1 ? points.reverse() : points));
  });

  const dots = [];
  for (let index = 1; index <= 3; index += 1) {
    dots.push(visible[Math.floor((visible.length * index) / 4)]);
  }
  return [dots[1], dots[0], dots[2]];
}

function inkFor(machine) {
  let length = 0;
  for (const visible of visibleBranches(machine)) {
    for (let column = 1; column < COLUMNS; column += 1) {
      const here = visible[column];
      const before = visible[column - 1];
      if (here !== null && before !== null) {
        length += Math.hypot(1 / STEPS_PER_UNIT, here - before);
      }
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
  if (isRelation(machine)) return TWO_PIECE_RELATIONS.includes(machine.family_id) ? 2 : 1;
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
    case BELL: {
      const front = Math.abs(a) === 1 ? multiplier(a, 1) : `${a} \\times `;
      return `${front}2^{-\\frac{${bracket(b)}^2}{${c}}}`;
    }
    case S_CURVE: {
      const power = b === 0 ? '-x' : `-${bracket(b)}`;
      return `${a < 0 ? '-' : ''}\\frac{${Math.abs(a)}}{1 + 2^{${power}}}${plus(c)}`;
    }
    case QUARTIC:
      return `${multiplier(a, 64)}\\left(${bracket(b)}^2 - ${c * c}\\right)^2`;
    case INVERSE_SQUARE:
      return `${a < 0 ? '-' : ''}\\frac{${Math.abs(a)}}{${bracket(b)}^2}${plus(c)}`;
    case TANGENT:
      return `${multiplier(a, 1)}\\tan\\left(\\frac{\\pi x}{${b}}\\right)${plus(c)}`;
    default:
      return `${multiplier(c, 2)}x ${a > 0 ? '+' : '-'} \\frac{${Math.abs(a)}}{${shifted(b)}}`;
  }
}

function yBracket(amount) {
  return bracket(amount).replace('x', 'y');
}

function over(top, bottom) {
  return bottom === 1 ? top : `\\frac{${top}}{${bottom}}`;
}

function describeRelation(machine) {
  const { a, b, c, d } = machine;
  if (machine.family_id === CIRCLE) return `${bracket(b)}^2 + ${yBracket(c)}^2 = ${a * a}`;
  if (machine.family_id === ELLIPSE) {
    return `\\frac{${bracket(b)}^2}{${a * a}} + \\frac{${yBracket(c)}^2}{${d * d}} = 1`;
  }
  if (machine.family_id === DIAMOND) {
    const across = `\\left|${shifted(b)}\\right|`;
    const down = `\\left|${shifted(c).replace('x', 'y')}\\right|`;
    return a === d ? `${across} + ${down} = ${a}` : `\\frac{${across}}{${a}} + \\frac{${down}}{${d}} = 1`;
  }
  if (machine.family_id === ROUNDED_SQUARE) return `${bracket(b)}^4 + ${yBracket(c)}^4 = ${a ** 4}`;
  if (machine.family_id === SIDEWAYS_V) {
    return `x = ${multiplier(a, 2)}\\left|${shifted(c).replace('x', 'y')}\\right|${plus(b)}`;
  }
  if (machine.family_id === SIDEWAYS_HYPERBOLA) {
    return `${over(`${bracket(b)}^2`, a * a)} - ${over(`${yBracket(c)}^2`, d * d)} = 1`;
  }
  if (machine.family_id === UPRIGHT_HYPERBOLA) {
    return `${over(`${yBracket(c)}^2`, d * d)} - ${over(`${bracket(b)}^2`, a * a)} = 1`;
  }
  return `x = ${multiplier(a, 4)}${yBracket(c)}^2${plus(b)}`;
}

function describe(machine) {
  if (isRelation(machine)) return describeRelation(machine);
  const main = expression(machine.family_id, machine.a, machine.b, machine.c);
  if (!machine.extra_family_id) return `y = ${main}`;

  const extra = expression(machine.extra_family_id, machine.extra_a, machine.extra_b, machine.extra_c);
  return extra.startsWith('-') ? `y = ${main} - ${extra.slice(1)}` : `y = ${main} + ${extra}`;
}

function asymptotes(machine) {
  const { a, b, c } = machine;
  const lines = [];
  const hugsVertical = [HYPERBOLA, SLANTED, INVERSE_SQUARE].includes(machine.family_id);
  if (hugsVertical) lines.push({ kind: 'vertical', input: b });
  if (machine.family_id === TANGENT) {
    for (let input = b / 2 - Math.ceil(LIMIT / b) * b; input < LIMIT; input += b) {
      if (input > -LIMIT) lines.push({ kind: 'vertical', input });
    }
  }

  let tilt = 0;
  if (machine.extra_family_id === LINE) tilt = machine.extra_a / 2;
  else if (machine.extra_family_id) return lines;

  if ([HYPERBOLA, EXPONENTIAL, INVERSE_SQUARE, S_CURVE].includes(machine.family_id)) {
    lines.push({ kind: 'sloped', slope: tilt, start: c });
  }
  if (machine.family_id === S_CURVE) lines.push({ kind: 'sloped', slope: tilt, start: a + c });
  if (machine.family_id === BELL) lines.push({ kind: 'sloped', slope: tilt, start: 0 });
  if (TWO_PIECE_RELATIONS.includes(machine.family_id)) {
    const slope = machine.d / a;
    lines.push({ kind: 'sloped', slope, start: c - slope * b }, { kind: 'sloped', slope: -slope, start: c + slope * b });
  }
  if (machine.family_id === SLANTED) {
    lines.push({ kind: 'sloped', slope: c / 2 + tilt, start: 0 });
  }
  return lines;
}

// Seeds for neighbouring days are evenly spaced, and a generator like this turns evenly spaced
// seeds into curves that come round in a cycle, so the seed is scrambled first.
function scramble(seed) {
  let value = seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) & 0x7fffffff;
}

function numberMaker(seed) {
  let value = scramble(seed);
  return (limit) => {
    value = (Math.imul(value, 1103515245) + 12345) & 0x7fffffff;
    return Math.floor((value / 2147483648) * limit);
  };
}

function dayNumber(date) {
  return Math.floor(Date.parse(date) / 86400000);
}

function todayDate() {
  const now = new Date();
  const two = (number) => String(number).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
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
    case BELL:
      return { a: pick([-8, -6, -4, 4, 6, 8]), b: between(-5, 5), c: pick([2, 4, 8]) };
    case S_CURVE:
      return { a: pick([-8, -6, -4, 4, 6, 8]), b: between(-4, 4), c: between(-4, 4) };
    case QUARTIC:
      return { a: pick([-4, -2, -1, 1, 2, 4]), b: between(-3, 3), c: pick([2, 3, 4]) };
    case INVERSE_SQUARE:
      return { a: nonZero(-6, 6), b: between(-5, 5), c: between(-5, 5) };
    case TANGENT:
      return { a: pick([-2, -1, 1, 2]), b: pick([7, 8]), c: between(-3, 3) };
    case CIRCLE: {
      const radius = between(3, 7);
      return { a: radius, b: between(radius - 9, 9 - radius), c: between(radius - 9, 9 - radius) };
    }
    case ELLIPSE: {
      const across = between(3, 8);
      let down = across;
      while (down === across) down = between(2, 8);
      return { a: across, b: between(across - 9, 9 - across), c: between(down - 9, 9 - down), d: down };
    }
    case SIDEWAYS:
      return { a: pick([-4, -2, -1, 1, 2, 4]), b: between(-6, 6), c: between(-5, 5) };
    case DIAMOND: {
      const across = between(3, 8);
      const down = between(3, 8);
      return { a: across, b: between(across - 9, 9 - across), c: between(down - 9, 9 - down), d: down };
    }
    case ROUNDED_SQUARE: {
      const size = between(3, 7);
      return { a: size, b: between(size - 9, 9 - size), c: between(size - 9, 9 - size) };
    }
    case SIDEWAYS_V:
      return { a: pick([-4, -2, -1, 1, 2, 4]), b: between(-6, 6), c: between(-5, 5) };
    case SIDEWAYS_HYPERBOLA:
      return { a: between(1, 4), b: between(-3, 3), c: between(-4, 4), d: between(1, 4) };
    case UPRIGHT_HYPERBOLA:
      return { a: between(1, 4), b: between(-4, 4), c: between(-3, 3), d: between(1, 4) };
    default:
      return { a: pick([-6, -4, -2, 2, 4, 6]), b: between(-4, 4), c: pick([-2, -1, 1, 2]) };
  }
}

const RECIPES_FOR_SLOT = {
  1: [[LINE], [PARABOLA], [V_SHAPE]],
  2: [[CUBIC], [WAVE], [CUBE_ROOT], [EXPONENTIAL], [BELL], [S_CURVE], [QUARTIC], [V_SHAPE, LINE], [CUBE_ROOT, LINE]],
  3: [[HYPERBOLA], [SLANTED], [INVERSE_SQUARE], [TANGENT], [HYPERBOLA, PARABOLA], [HYPERBOLA, V_SHAPE],
    [EXPONENTIAL, LINE], [S_CURVE, LINE]],
  4: [[CIRCLE], [ELLIPSE], [SIDEWAYS], [DIAMOND], [ROUNDED_SQUARE], [SIDEWAYS_V], [SIDEWAYS_HYPERBOLA],
    [UPRIGHT_HYPERBOLA]]
};
// A wave is never used as the second part. A small ripple on a big shape sits inside the
// marking's tolerance, so the plain shape would pass and the wave would never need finding.

function randomExtra(next, familyId) {
  const between = (low, high) => low + next(high - low + 1);
  const pick = (choices) => choices[next(choices.length)];

  switch (familyId) {
    case LINE:
      return { extra_a: pick([-3, -2, -1, 1, 2, 3]), extra_b: 0, extra_c: 0 };
    case PARABOLA:
      return { extra_a: pick([-1, 1]), extra_b: between(-3, 3), extra_c: 0 };
    default:
      return { extra_a: pick([-2, -1, 1, 2]), extra_b: between(-3, 3), extra_c: 0 };
  }
}

function machineFromSeed(seed, slot) {
  const next = numberMaker(seed);
  // About one hard curve in three is a loop or turn instead.
  const recipes = slot === 3 && next(3) === 0 ? RECIPES_FOR_SLOT[4] : RECIPES_FOR_SLOT[slot];
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
    if (isRelation(machine)) break;
    onScreen = visibleCurve(machine).filter((output) => output !== null).length;
    if (stopsShort(machine)) onScreen = 0;
  }
  return machine;
}

// Names like "V shape" and "S-curve" start with a letter that stands for the shape, so they keep it.
function lowerName(name) {
  return /^[A-Z][ -]/.test(name) ? name : name[0].toLowerCase() + name.slice(1);
}

function kindName(machine) {
  return machine.extra_name
    ? `${machine.family_name} + ${lowerName(machine.extra_name)}`
    : machine.family_name;
}

function shapeOf(machine) {
  const added = machine.extra_name ? ` It has a ${lowerName(machine.extra_name)} added on to it.` : '';
  return `${kindName(machine)}. ${machine.family_description}${added}`;
}

function pastDates() {
  const today = dayNumber(todayDate());
  const dates = [];
  for (let day = today - 1; day >= today - DAYS_OF_HISTORY; day -= 1) {
    dates.push(new Date(day * 86400000).toISOString().slice(0, 10));
  }
  return dates;
}

// Everything shown once a curve is finished, apart from the formula drawn as maths.
function revealed(machine, accuracy, solved, goes, hints) {
  return {
    accuracy,
    solved,
    finished: true,
    score: scoreFor(accuracy, goes, hints),
    curve: visibleBranches(machine),
    familyName: kindName(machine),
    formula: describe(machine),
    asymptotes: asymptotes(machine)
  };
}

// Marks one attempt and builds the reply the page shows.
// The right shape in slightly the wrong place only counts on the last attempt, so it can
// rescue a curve that would otherwise be failed but never ends one that could still be improved.
function markAttempt(drawing, machine, go, hints) {
  const result = judge(drawing, machine);
  const lastAttempt = go === MAX_GOES;
  const solved = result.solved || (result.closeEnough && lastAttempt);
  const reply = solved || lastAttempt
    ? revealed(machine, result.accuracy, solved, go, hints)
    : { accuracy: result.accuracy, solved: false, finished: false };
  return {
    ...reply,
    closeEnough: result.closeEnough,
    levels: result.levels,
    nudges: result.nudges,
    missed: result.missed,
    missedRows: result.missedRows
  };
}

// The first hint says what kind of curve it is. The ones after it are spots on the curve.
function hintFor(machine, number) {
  return number === 1 ? { shape: shapeOf(machine) } : { dot: hintDots(machine)[number - 2] };
}

const FAMILIES = {
  1: { name: 'Straight line', difficulty: 1, description: 'Goes up or down by the same amount with every step across.' },
  2: { name: 'Parabola', difficulty: 1, description: 'A smooth U shape, or an upside-down U, with one turning point.' },
  3: { name: 'V shape', difficulty: 1, description: 'Two straight lines meeting at a sharp corner, pointing up or down.' },
  4: { name: 'Cubic', difficulty: 2, description: 'A curve with one hill and one dip, heading off in opposite directions at each end.' },
  5: { name: 'Wave', difficulty: 2, description: 'Rises and falls in a repeating pattern, like ripples.' },
  6: { name: 'Cube root', difficulty: 2, description: 'A sideways S: steep in the middle and flattening out towards both sides.' },
  7: { name: 'Exponential', difficulty: 2, description: 'Almost flat on one side, then shoots away faster and faster on the other.' },
  8: { name: 'Hyperbola', difficulty: 3, description: 'Two separate pieces that get closer and closer to a vertical line and a flat line without touching them.' },
  9: { name: 'Slanted hyperbola', difficulty: 3, description: 'Two pieces that get closer and closer to a vertical line and a sloping line.' },
  10: { name: 'Bell curve', difficulty: 2, description: 'A single smooth hump, or dip, that flattens out to nothing on both sides.' },
  11: { name: 'S-curve', difficulty: 2, description: 'Flat on one side, a smooth climb or drop in the middle, then flat again at a new level.' },
  12: { name: 'Quartic', difficulty: 2, description: 'A W shape, or an upside-down W, with two dips and a bump in between.' },
  13: { name: 'Inverse square', difficulty: 3, description: 'Two pieces that both shoot up, or both shoot down, beside a vertical line.' },
  14: { name: 'Tangent', difficulty: 3, description: 'Repeating S shapes, each squeezed between two vertical lines it never touches.' },
  15: { name: 'Circle', difficulty: 3, description: 'A perfectly round loop.' },
  16: { name: 'Ellipse', difficulty: 3, description: 'A stretched loop, wider than it is tall or taller than it is wide.' },
  17: { name: 'Sideways parabola', difficulty: 3, description: 'A U shape lying on its side, opening to the left or the right.' },
  18: { name: 'Diamond', difficulty: 3, description: 'A loop with four straight sides and four sharp corners, like a square standing on one corner.' },
  19: { name: 'Rounded square', difficulty: 3, description: 'A loop like a square with its corners rounded off.' },
  20: { name: 'Sideways V', difficulty: 3, description: 'Two straight lines meeting at a sharp point, opening to the left or the right.' },
  21: { name: 'Sideways hyperbola', difficulty: 3, description: 'Two separate U shapes lying on their sides and opening away from each other.' },
  22: { name: 'Up and down hyperbola', difficulty: 3, description: 'Two separate U shapes, one opening upwards and one opening downwards.' }
};

publish({
  COLUMNS, CROSSED, GO_PENALTY, HINT_PENALTY, LIMIT, MAX_GOES, MAX_HINTS, MOST_POINTS, TOP_SCORE,
  SHORTEST_STROKE, STEPS_PER_UNIT, LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, CUBE_ROOT, EXPONENTIAL, HYPERBOLA,
  SLANTED, BELL, S_CURVE, QUARTIC, INVERSE_SQUARE, TANGENT, CIRCLE, ELLIPSE, SIDEWAYS, DIAMOND, ROUNDED_SQUARE,
  SIDEWAYS_V, SIDEWAYS_HYPERBOLA, UPRIGHT_HYPERBOLA, asymptotes, describe, numberMaker, evaluate, exits,
  inputFor, judge, machineFromSeed, hintDots, inkFor, inkUsed, isRelation, kindName, pastDates, pieces,
  scoreFor, shapeOf, thinned, todayDate, stopsShort, validDrawing, visibleBranches, visibleCurve, wholeCurve, FAMILIES,
  SOLVED_AT, dayNumber, hintFor, markAttempt, revealed
});
}((api) => {
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.Curves = api;
}));
