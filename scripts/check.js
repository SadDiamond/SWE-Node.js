const assert = require('node:assert');
const katex = require('katex');
const rules = require('../src/rules');

const {
  COLUMNS, LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, CUBE_ROOT, EXPONENTIAL, HYPERBOLA, SLANTED,
  BELL, S_CURVE, QUARTIC, INVERSE_SQUARE, TANGENT
} = rules;

assert.strictEqual(rules.evaluate({ family_id: LINE, a: 3, b: -2, c: 0 }, 4), 4);
assert.strictEqual(rules.evaluate({ family_id: PARABOLA, a: 4, b: 1, c: -3 }, 3), 1);
assert.strictEqual(rules.evaluate({ family_id: V_SHAPE, a: 2, b: 0, c: 0 }, -5), 5);
assert.strictEqual(rules.evaluate({ family_id: CUBIC, a: 2, b: 1, c: 4 }, 3), -3);
assert.strictEqual(rules.evaluate({ family_id: CUBIC, a: 2, b: 1, c: 4 }, 5), 0, 'a cubic crosses zero at b + c');
assert.strictEqual(rules.evaluate({ family_id: WAVE, a: 3, b: 4, c: 1 }, 2), 4);
assert.strictEqual(rules.evaluate({ family_id: CUBE_ROOT, a: 2, b: -4, c: 0 }, 4), 4);
assert.strictEqual(rules.evaluate({ family_id: CUBE_ROOT, a: 2, b: -4, c: 0 }, -12), -4, 'a cube root exists on both sides');
assert.strictEqual(rules.evaluate({ family_id: EXPONENTIAL, a: 1, b: 2, c: -1 }, 4), 3);
assert.strictEqual(rules.evaluate({ family_id: HYPERBOLA, a: 6, b: 2, c: 1 }, 5), 3);
assert.strictEqual(rules.evaluate({ family_id: HYPERBOLA, a: 6, b: 2, c: 1 }, 2), null, 'nothing exists on the asymptote');
assert.strictEqual(rules.evaluate({ family_id: SLANTED, a: 4, b: 0, c: 2 }, 2), 4);
assert.strictEqual(rules.evaluate({ family_id: BELL, a: 6, b: 1, c: 4 }, 1), 6, 'a bell curve peaks at b');
assert.strictEqual(rules.evaluate({ family_id: BELL, a: 6, b: 1, c: 4 }, 3), 3, 'and halves two steps away when c is 4');
assert.strictEqual(rules.evaluate({ family_id: S_CURVE, a: 8, b: 0, c: -4 }, 0), 0, 'an S-curve is halfway up at b');
assert.strictEqual(rules.evaluate({ family_id: QUARTIC, a: 2, b: 0, c: 3 }, 3), 0, 'a quartic touches zero at b plus or minus c');
assert.strictEqual(rules.evaluate({ family_id: INVERSE_SQUARE, a: -4, b: 2, c: 3 }, 4), 2);
assert.strictEqual(rules.evaluate({ family_id: INVERSE_SQUARE, a: -4, b: 2, c: 3 }, 2), null);
assert.strictEqual(rules.evaluate({ family_id: TANGENT, a: 1, b: 8, c: 0 }, 4), null, 'a tangent has an asymptote at half its period');
assert.strictEqual(rules.pieces({ family_id: TANGENT, a: 1, b: 8, c: 0 }), 3, 'and is in three pieces');

const formula = (familyId, a, b, c) => rules.describe({ family_id: familyId, a, b, c });
assert.strictEqual(formula(LINE, 3, -2, 0), 'y = \\frac{3}{2}x - 2');
assert.strictEqual(formula(LINE, -2, 0, 0), 'y = -x');
assert.strictEqual(formula(LINE, 4, 1, 0), 'y = 2x + 1');
assert.strictEqual(formula(PARABOLA, 2, 3, -4), 'y = \\frac{1}{2}(x - 3)^2 - 4');
assert.strictEqual(formula(PARABOLA, 4, 0, 0), 'y = x^2');
assert.strictEqual(formula(V_SHAPE, -2, -1, 5), 'y = -\\left|x + 1\\right| + 5');
assert.strictEqual(formula(CUBIC, 2, 1, 4), 'y = \\frac{1}{8}(x + 3)(x - 1)(x - 5)');
assert.strictEqual(formula(CUBIC, -16, 0, 4), 'y = -(x + 4)x(x - 4)');
assert.strictEqual(formula(WAVE, 3, 4, 1), 'y = 3\\sin\\left(\\frac{\\pi x}{4}\\right) + 1');
assert.strictEqual(formula(CUBE_ROOT, 2, -3, -1), 'y = 2\\sqrt[3]{x + 3} - 1');
assert.strictEqual(formula(EXPONENTIAL, 2, 3, -4), 'y = 2 \\times 2^{\\frac{x}{3}} - 4');
assert.strictEqual(formula(EXPONENTIAL, -1, 1, 0), 'y = -2^{x}');
assert.strictEqual(formula(EXPONENTIAL, 1, -2, 3), 'y = 2^{-\\frac{x}{2}} + 3');
assert.strictEqual(formula(HYPERBOLA, 3, 2, 1), 'y = \\frac{3}{x - 2} + 1');
assert.strictEqual(formula(HYPERBOLA, -3, 0, 0), 'y = -\\frac{3}{x}');
assert.strictEqual(formula(SLANTED, -4, 1, 1), 'y = \\frac{1}{2}x - \\frac{4}{x - 1}');
assert.strictEqual(formula(BELL, 6, 1, 4), 'y = 6 \\times 2^{-\\frac{(x - 1)^2}{4}}');
assert.strictEqual(formula(S_CURVE, -6, 2, 3), 'y = -\\frac{6}{1 + 2^{-(x - 2)}} + 3');
assert.strictEqual(formula(QUARTIC, 2, 0, 3), 'y = \\frac{1}{32}\\left(x^2 - 9\\right)^2');
assert.strictEqual(formula(INVERSE_SQUARE, -4, 2, 3), 'y = -\\frac{4}{(x - 2)^2} + 3');
assert.strictEqual(formula(TANGENT, -2, 8, 1), 'y = -2\\tan\\left(\\frac{\\pi x}{8}\\right) + 1');

const steep = { family_id: LINE, a: 6, b: 0, c: 0 };
const curve = rules.visibleCurve(steep);
assert.strictEqual(curve.length, COLUMNS);
assert.strictEqual(curve[100], 0, 'the middle column is input 0');
assert.strictEqual(curve[0], null, 'y = 3x is off the bottom at the left edge');

assert.deepStrictEqual(rules.exits(steep).map((exit) => exit.side), ['bottom', 'top']);
const hyperbola = { family_id: HYPERBOLA, a: 3, b: 0, c: 0 };
assert.deepStrictEqual(rules.exits(hyperbola).map((exit) => exit.side), ['bottom', 'top', 'left', 'right']);
assert.deepStrictEqual(rules.exits(hyperbola).find((exit) => exit.side === 'left'), { output: -0.3, side: 'left' },
  'side arrows sit at the height where the curve meets the edge');
assert.strictEqual(rules.asymptotes(hyperbola).length, 2);
assert.strictEqual(rules.asymptotes(steep).length, 0);

function traced(values, across = 0, up = 0) {
  const stroke = [];
  values.forEach((value, column) => {
    if (value !== null) stroke.push([rules.inputFor(column) + across, value + up]);
  });
  return [stroke.filter(([x, y]) => Math.abs(x) <= 10 && Math.abs(y) <= 10)];
}

const perfect = rules.judge(traced(curve), steep);
assert.strictEqual(perfect.accuracy, 100);
assert.strictEqual(perfect.solved, true);

const sideways = rules.judge(traced(curve, 0.4), steep);
assert.ok(sideways.accuracy >= 85, `a steep line drawn just to one side scores ${sideways.accuracy}`);
assert.ok(!sideways.missed.includes(true), 'the curve is not missed when the drawing is right beside it');

const gentle = { family_id: LINE, a: 1, b: 0, c: 0 };
const raised = rules.judge(traced(rules.visibleCurve(gentle), 0, 1), gentle);
assert.ok(raised.levels[0].includes(1) && !raised.levels[0].includes(0), 'one unit off is level 1, not spot on');
assert.ok(raised.accuracy >= 70 && raised.accuracy <= 80, `one unit off scores about 75, got ${raised.accuracy}`);

const flat = rules.judge([[[-10, 9], [10, 9]]], steep);
assert.ok(flat.accuracy < 25, `a flat line across the top scores badly, got ${flat.accuracy}`);
assert.ok(flat.missed.includes(true), 'most of the curve is missed');

function flatLine(height) {
  const stroke = [];
  for (let x = -10; x <= 10; x += 0.1) stroke.push([Math.round(x * 10) / 10, height]);
  return [stroke];
}
const high = rules.judge(flatLine(9), gentle);
assert.ok(high.nudges.length > 3, 'a line that is way off gets several nudges');
assert.ok(high.nudges.every((nudge) => Math.abs(Math.hypot(nudge.across, nudge.up) - 1) < 0.02), 'every nudge is the same length');
assert.ok(high.nudges.every((nudge) => nudge.up < 0), 'a line far above the curve is nudged downwards');
const below = rules.judge(flatLine(-9), gentle);
assert.ok(below.nudges.every((nudge) => nudge.up > 0), 'a line far below the curve is nudged upwards');
assert.strictEqual(perfect.nudges.length, 0, 'a line on the curve gets no nudges');
assert.strictEqual(raised.nudges.length, 0, 'a line that is only a little off gets no nudges');

for (const slot of [1, 2, 3]) {
  const machine = rules.makeMachine('2026-11-13', slot);
  const dots = rules.hintDots(machine);
  assert.strictEqual(dots.length, 3);
  assert.strictEqual(new Set(dots.map(([x]) => x)).size, 3, 'the three dots are in different places');
  dots.forEach(([x, y]) => {
    assert.ok(Math.abs(rules.evaluate(machine, x) - y) < 0.01, 'each dot sits on the curve');
  });
}

assert.strictEqual(rules.inkUsed([[[0, 0], [3, 4]], [[0, 0], [0, 2]]]), 7);
assert.strictEqual(rules.inkFor(gentle), 34, 'a gentle line 22.4 long gets half as much again');
assert.strictEqual(rules.inkFor({ family_id: PARABOLA, a: 4, b: 0, c: 9 }), 30, 'a short visible curve still gets the smallest amount');
for (const slot of [1, 2, 3]) {
  const machine = rules.makeMachine('2026-11-13', slot);
  const ownLength = rules.inkUsed(traced(rules.visibleCurve(machine)));
  assert.ok(rules.inkFor(machine) >= ownLength, 'there is always enough ink to draw the curve itself');
  assert.ok(rules.inkFor(machine) < 400, 'there is never enough to fill the graph');
}

const bowl = { family_id: PARABOLA, a: 2, b: 0, c: -5 };
const bowlCurve = rules.visibleCurve(bowl);
const shifted = rules.judge(traced(bowlCurve, 1.5, 1), bowl);
assert.ok(shifted.accuracy < 85, `a parabola drawn 1.5 across and 1 up misses the pass mark, got ${shifted.accuracy}`);
assert.strictEqual(shifted.closeEnough, true, 'but it is the right shape, so it can be accepted');
assert.strictEqual(shifted.solved, false, 'only on the last attempt, which the server decides');
assert.ok(rules.scoreFor(shifted.accuracy, 1, 0) < rules.scoreFor(100, 1, 0), 'and it scores less than a perfect one');

const spotOn = rules.judge(traced(bowlCurve), bowl);
assert.strictEqual(spotOn.closeEnough, false, 'a drawing that passes outright is not marked as close enough');

const upsideDown = rules.judge(traced(bowlCurve.map((value) => (value === null ? null : -value))), bowl);
assert.strictEqual(upsideDown.closeEnough, false, 'an upside-down parabola is not accepted');
const farOff = rules.judge(traced(bowlCurve, 5, 0), bowl);
assert.strictEqual(farOff.closeEnough, false, 'the right shape five units to one side is not accepted');
assert.strictEqual(rules.judge(flatLine(-5), bowl).closeEnough, false, 'a flat line is not a parabola');
assert.strictEqual(rules.judge(flatLine(9), gentle).closeEnough, false);

const vertical = rules.judge([[[0, -9], [0, 9]]], steep);
assert.ok(vertical.accuracy > flat.accuracy, 'a vertical line through a steep curve beats a flat one');
const loop = [[[3, 0], [0, 3], [-3, 0], [0, -3], [3, 0]]];
assert.strictEqual(rules.validDrawing(loop), true);
assert.strictEqual(rules.judge(loop, steep).levels[0].length, 5);

const scribble = [];
for (let y = -9; y <= 9; y += 1) scribble.push([[-10, y], [10, y]]);
assert.strictEqual(rules.validDrawing(scribble), false, 'too many strokes are refused');
const zigzag = [[]];
for (let x = -10; x <= 10; x += 0.5) zigzag[0].push([x, (x * 2) % 2 === 0 ? -9 : 9]);
assert.ok(rules.judge(zigzag, steep).accuracy < 60, 'a zigzag over the whole graph does not pass');

assert.strictEqual(rules.validDrawing([]), false);
assert.strictEqual(rules.validDrawing([[[0, 0]]]), false, 'a stroke needs at least two positions');
assert.strictEqual(rules.validDrawing([[[0, 0], [1, 99]]]), false, 'positions must be on the graph');
assert.strictEqual(rules.validDrawing([[[0, 0], ['1', 1]]]), false, 'positions must be numbers');
assert.strictEqual(rules.validDrawing('nope'), false);

assert.strictEqual(rules.pieces(steep), 1);
assert.strictEqual(rules.pieces(hyperbola), 2, 'a hyperbola is in two pieces');
assert.strictEqual(rules.pieces({ family_id: EXPONENTIAL, a: 1, b: 1, c: 0 }), 1, 'a flat asymptote does not split a curve');

const swapped = { family_id: HYPERBOLA, a: -5, b: 0, c: -2 };
const wrongSide = rules.judge([[[0.3, 9], [0.3, 3]], [[-0.3, -3], [-0.3, -9]]], swapped);
assert.ok(wrongSide.levels.flat().every((level) => level === 4), 'branches drawn on the wrong side of the asymptote are way off');
assert.strictEqual(wrongSide.closeEnough, false, 'the wrong-side drawing is not even close enough');
const rightSide = rules.judge([[[-0.6, 9], [-0.8, 4]], [[0.8, -8], [0.6, -10]]], swapped);
assert.ok(rightSide.levels.flat().every((level) => level === 0), 'branches drawn on the right side are spot on');
const bridge = rules.judge([[[-0.5, 8], [0.5, -9]], [[5, -3], [6, -3]]], swapped);
assert.strictEqual(bridge.levels[0][1], rules.CROSSED, 'a line jumping across the asymptote is greyed out');
const crossingStroke = [];
for (let x = -3; x <= 3.001; x += 0.1) crossingStroke.push([Math.round(x * 10) / 10, 0]);
const crossed = rules.judge([crossingStroke], swapped).levels[0];
assert.ok(crossed.every((level, index) => (Math.abs(crossingStroke[index][0]) <= 0.5) === (level === rules.CROSSED)),
  'only the part of the line near the asymptote is greyed out');
const [whole] = traced(rules.visibleCurve(swapped));
const branches = [whole.filter(([x]) => x < 0), whole.filter(([x]) => x > 0)];
assert.strictEqual(rules.judge(branches, swapped).accuracy, 100, 'tracing each branch is still perfect');

const {
  CIRCLE, ELLIPSE, SIDEWAYS, DIAMOND, ROUNDED_SQUARE, SIDEWAYS_V, SIDEWAYS_HYPERBOLA, UPRIGHT_HYPERBOLA
} = rules;
const circle = { family_id: CIRCLE, a: 5, b: 1, c: -2 };
assert.strictEqual(rules.describe(circle), '(x - 1)^2 + (y + 2)^2 = 25');
assert.strictEqual(rules.describe({ family_id: ELLIPSE, a: 4, b: 0, c: 1, d: 2 }), '\\frac{x^2}{16} + \\frac{(y - 1)^2}{4} = 1');
assert.strictEqual(rules.describe({ family_id: SIDEWAYS, a: -2, b: 3, c: 0 }), 'x = -\\frac{1}{2}y^2 + 3');
assert.strictEqual(rules.pieces(circle), 1, 'a circle is drawn in one stroke');
assert.deepStrictEqual(rules.exits(circle), [], 'a circle inside the graph touches no edge');
const ring = [];
for (let step = 0; step <= 200; step += 1) {
  const angle = (step / 200) * 2 * Math.PI;
  ring.push([1 + 5 * Math.cos(angle), -2 + 5 * Math.sin(angle)]);
}
assert.strictEqual(rules.judge([ring], circle).accuracy, 100, 'tracing the circle is perfect');
const halfLoop = rules.judge([ring.slice(0, 101)], circle);
assert.ok(halfLoop.accuracy < 85, `half a circle does not pass, got ${halfLoop.accuracy}`);
assert.ok(halfLoop.missedRows.some(Boolean), 'missing the bottom half shows grey bars down the side');
assert.ok(rules.judge([ring], { family_id: CIRCLE, a: 3, b: 1, c: -2 }).accuracy < 85, 'a circle the wrong size does not pass');
assert.strictEqual(rules.describe({ family_id: DIAMOND, a: 4, b: 1, c: 0, d: 4 }), '\\left|x - 1\\right| + \\left|y\\right| = 4');
assert.strictEqual(rules.describe({ family_id: ROUNDED_SQUARE, a: 3, b: 0, c: -2 }), 'x^4 + (y + 2)^4 = 81');
assert.strictEqual(rules.describe({ family_id: SIDEWAYS_V, a: -2, b: 3, c: 1 }), 'x = -\\left|y - 1\\right| + 3');
assert.strictEqual(rules.describe({ family_id: UPRIGHT_HYPERBOLA, a: 2, b: 4, c: -1, d: 1 }), '(y + 1)^2 - \\frac{(x - 4)^2}{4} = 1');

const diamond = { family_id: DIAMOND, a: 4, b: 0, c: 0, d: 6 };
const diamondTrace = [[4, 0], [0, 6], [-4, 0], [0, -6], [4, 0]].flatMap(([x, y], index, corners) => {
  if (index === corners.length - 1) return [[x, y]];
  const [nextX, nextY] = corners[index + 1];
  return Array.from({ length: 40 }, (_, step) => [x + ((nextX - x) * step) / 40, y + ((nextY - y) * step) / 40]);
});
assert.strictEqual(rules.judge([diamondTrace], diamond).accuracy, 100, 'tracing the diamond is perfect');

const sidewaysHyperbola = { family_id: SIDEWAYS_HYPERBOLA, a: 2, b: 0, c: 0, d: 2 };
assert.strictEqual(rules.pieces(sidewaysHyperbola), 2, 'a sideways hyperbola is two strokes');
const arm = (side) => {
  const points = [];
  for (let y = -9; y <= 9.001; y += 0.2) points.push([side * 2 * Math.sqrt(1 + (y / 2) ** 2), y]);
  return points.filter(([x]) => Math.abs(x) <= 10);
};
assert.ok(rules.judge([arm(1), arm(-1)], sidewaysHyperbola).accuracy >= 98, 'tracing both halves scores full marks');
assert.ok(rules.judge([arm(1)], sidewaysHyperbola).accuracy < 85, 'drawing only one half does not pass');

const square = { family_id: ROUNDED_SQUARE, a: 5, b: 1, c: -3 };
const squashed = [];
for (let t = 0; t <= 1.0001; t += 0.01) squashed.push([5.4 - 9.4 * t, 3.5 * Math.sin(Math.PI * t)]);
for (let t = 0; t <= 1.0001; t += 0.01) squashed.push([-4 + 9 * t, -1.5 * Math.sin(Math.PI * t)]);
const lowerArrows = rules.judge([squashed], square).nudges.filter((nudge) => nudge.y < 0 && nudge.x > -3 && nudge.x < 4);
assert.ok(lowerArrows.length > 0 && lowerArrows.every((nudge) => nudge.up < 0),
  'on a squashed loop, the arrows on its bottom line point down to the bottom of the shape, not up to the nearest edge');

const relationsSeen = new Set();
for (let seed = 1; seed <= 300; seed += 1) {
  const relation = rules.machineFromSeed(seed * 9973, 4);
  relationsSeen.add(relation.family_id);
  assert.ok(rules.isRelation(relation));
  const twoPieces = [SIDEWAYS_HYPERBOLA, UPRIGHT_HYPERBOLA].includes(relation.family_id);
  assert.strictEqual(rules.pieces(relation), twoPieces ? 2 : 1);
  assert.ok(rules.inkFor(relation) >= 30);
  assert.doesNotThrow(() => katex.renderToString(rules.describe(relation), { output: 'mathml' }));
  const dots = rules.hintDots(relation);
  assert.strictEqual(new Set(dots.map((dot) => dot.join())).size, 3, 'three different hint dots');
  if ([CIRCLE, ELLIPSE, DIAMOND, ROUNDED_SQUARE].includes(relation.family_id)) {
    assert.deepStrictEqual(rules.exits(relation), [], 'loops stay inside the graph');
  }
}
assert.strictEqual(relationsSeen.size, 8, 'every kind of loop and turn comes up');

assert.strictEqual(rules.scoreFor(100, 1, 0), 1000, 'a perfect first go with no hints is full marks');
assert.strictEqual(rules.scoreFor(92, 1, 0), 920);
assert.strictEqual(rules.scoreFor(92, 3, 0), 720, 'each extra go costs 100');
assert.strictEqual(rules.scoreFor(92, 3, 2), 420, 'each hint costs 150');
assert.strictEqual(rules.scoreFor(40, 5, 3), 0, 'a score never goes below zero');

const tiltedRoot = {
  family_id: CUBE_ROOT, a: 2, b: 0, c: 1, extra_family_id: LINE, extra_a: 2, extra_b: 0, extra_c: 0
};
assert.strictEqual(rules.evaluate(tiltedRoot, 8), 13, 'the two parts are added: (2 x 2 + 1) + 8');
assert.strictEqual(rules.describe(tiltedRoot), 'y = 2\\sqrt[3]{x} + 1 + x');
const tiltedV = {
  family_id: V_SHAPE, a: 2, b: 1, c: -3, extra_family_id: LINE, extra_a: -1, extra_b: 0, extra_c: 0
};
assert.strictEqual(rules.describe(tiltedV), 'y = \\left|x - 1\\right| - 3 - \\frac{1}{2}x', 'a second part with a minus sign is taken away');
const trident = {
  family_id: HYPERBOLA, a: 3, b: 0, c: 0, extra_family_id: PARABOLA, extra_a: 1, extra_b: 0, extra_c: 0
};
assert.strictEqual(rules.evaluate(trident, 0), null, 'a mix does not exist where either part does not');
assert.strictEqual(rules.pieces(trident), 2, 'a hyperbola mix is still in two pieces');
assert.deepStrictEqual(rules.asymptotes(trident), [{ kind: 'vertical', input: 0 }], 'only the vertical asymptote is a straight line');
const tiltedHyperbola = {
  family_id: HYPERBOLA, a: 3, b: 1, c: 2, extra_family_id: LINE, extra_a: 2, extra_b: 0, extra_c: 0
};
assert.deepStrictEqual(rules.asymptotes(tiltedHyperbola)[1], { kind: 'sloped', slope: 1, start: 2 }, 'a line added on tilts the asymptote');
assert.strictEqual(rules.kindName({ family_name: 'Hyperbola', extra_name: 'Parabola' }), 'Hyperbola + parabola');
assert.strictEqual(rules.kindName({ family_name: 'Wave', extra_name: null }), 'Wave');

const exact = rules.numberMaker(1);
const [first, second] = [exact(2147483648), exact(2147483648)];
assert.strictEqual(second, Number((BigInt(first) * 1103515245n + 12345n) % 2147483648n), 'the generator does exact whole-number maths');

const seen = new Set();
let mixes = 0;
for (let day = 0; day < 365; day += 1) {
  const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
  for (const slot of [1, 2, 3]) {
    const machine = rules.makeMachine(date, slot);
    const visible = rules.visibleCurve(machine).filter((output) => output !== null).length;
    assert.ok(!rules.stopsShort(machine), 'no curve ends in mid-air beside its asymptote');

    assert.deepStrictEqual(rules.makeMachine(date, slot), machine);
    assert.ok(machine.a !== 0 && Math.abs(machine.a) <= 9 && Math.abs(machine.b) <= 9 && Math.abs(machine.c) <= 9);
    assert.ok(visible >= COLUMNS * 0.5, `the curve is visible across at least half the graph on ${date}`);
    assert.ok(!rules.describe(machine).includes('NaN') && !rules.describe(machine).includes('undefined'));
    assert.ok(rules.inkFor(machine) >= 30 && rules.hintDots(machine).length === 3);
    const gaps = rules.wholeCurve(machine).filter((output) => output === null).length;
    const walls = rules.asymptotes(machine).filter((line) => line.kind === 'vertical').length;
    assert.ok(gaps <= walls, `the curve on ${date} must not start or stop partway across`);
    assert.doesNotThrow(() => katex.renderToString(rules.describe(machine), { output: 'mathml' }));
    seen.add(machine.family_id);
    if (machine.extra_family_id) {
      mixes += 1;
      assert.notStrictEqual(machine.extra_family_id, WAVE, 'a wave is never the second part of a mix');
      assert.ok(machine.extra_a !== 0 && Math.abs(machine.extra_a) <= 9, 'the second part has valid numbers');
    }
  }
  assert.strictEqual(rules.makeMachine(date, 1).extra_family_id, null, 'the easy curve is always a single kind');
}
assert.strictEqual(seen.size, 14, 'every family turns up during the year');
assert.ok(mixes > 150 && mixes < 600, `a good share of medium and hard curves are mixes, got ${mixes}`);

for (let seed = 1; seed < 3000; seed += 37) {
  for (const slot of [1, 2, 3]) {
    const machine = rules.machineFromSeed(seed, slot);
    assert.deepStrictEqual(rules.machineFromSeed(seed, slot), machine);
    assert.ok(rules.visibleCurve(machine).filter((output) => output !== null).length >= COLUMNS * 0.5);
  }
}

console.log('All rule checks passed.');
