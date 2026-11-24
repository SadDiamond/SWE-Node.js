
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
function svgElement(name, attributes, text) {
  const item = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    item.setAttribute(key, value);
  }
  if (text !== undefined) item.textContent = text;
  return item;
}

function scaleFor(svg, limit) {
  const size = svg.clientWidth;
  return {
    size,
    xFor: (x) => ((x + limit) / (2 * limit)) * size,
    yFor: (y) => ((limit - y) / (2 * limit)) * size
  };
}

function graphPosition(svg, event, limit) {
  const corner = svg.getBoundingClientRect();
  const across = (event.clientX - corner.left) / corner.width;
  const down = (event.clientY - corner.top) / corner.height;
  const clamp = (value) => Math.max(-limit, Math.min(limit, value));
  return {
    x: clamp(across * 2 * limit - limit),
    y: clamp(limit - down * 2 * limit)
  };
}

// The numbers at the ends of the axes sit right where an edge arrow can be, so a number is
// left out when an arrow is close enough to cover it.
function coveredByExit(exits, side, along) {
  return exits.some((exit) => exit.side === side && Math.abs((exit.input ?? exit.output) - along) < 1.5);
}

function drawGrid(svg, scale, limit, exits) {
  svg.append(svgElement('rect', { class: 'paper', x: 0, y: 0, width: scale.size, height: scale.size }));

  for (let value = -limit; value <= limit; value += 1) {
    if (value === 0) continue;
    const kind = value % 5 === 0 ? 'grid major' : 'grid';
    svg.append(
      svgElement('line', { class: kind, x1: scale.xFor(value), x2: scale.xFor(value), y1: 0, y2: scale.size }),
      svgElement('line', { class: kind, x1: 0, x2: scale.size, y1: scale.yFor(value), y2: scale.yFor(value) })
    );
  }
  svg.append(
    svgElement('line', { class: 'axis', x1: scale.xFor(0), x2: scale.xFor(0), y1: 0, y2: scale.size }),
    svgElement('line', { class: 'axis', x1: 0, x2: scale.size, y1: scale.yFor(0), y2: scale.yFor(0) })
  );

  for (const value of [-limit, -limit / 2, limit / 2, limit]) {
    const nearEdge = Math.abs(value) === limit;
    const label = String(value).replace('-', '−');
    const acrossCovered = nearEdge && coveredByExit(exits, value < 0 ? 'left' : 'right', 0);
    const upCovered = nearEdge && coveredByExit(exits, value < 0 ? 'bottom' : 'top', 0);
    if (!acrossCovered) svg.append(
      svgElement('text', {
        class: 'tick',
        x: scale.xFor(value) + (value < 0 && nearEdge ? 4 : -4),
        y: scale.yFor(0) + 16,
        'text-anchor': value < 0 && nearEdge ? 'start' : 'end'
      }, label));
    if (!upCovered) svg.append(
      svgElement('text', {
        class: 'tick',
        x: scale.xFor(0) - 6,
        y: scale.yFor(value) + (value > 0 && nearEdge ? 14 : -4),
        'text-anchor': 'end'
      }, label)
    );
  }
}

function strokePath(stroke, scale) {
  const points = stroke.map(([x, y]) => `${scale.xFor(x).toFixed(1)} ${scale.yFor(y).toFixed(1)}`);
  return `M${points[0]} L${points.join(' L')}`;
}

function drawMarked(group, strokes, levels, scale) {
  const at = ([x, y]) => `${scale.xFor(x).toFixed(1)} ${scale.yFor(y).toFixed(1)}`;
  strokes.forEach((stroke, strokeIndex) => {
    let path = null;
    for (let index = 1; index < stroke.length; index += 1) {
      const level = levels[strokeIndex][index];
      if (path && path.level === level) {
        path.d += ` L${at(stroke[index])}`;
      } else {
        if (path) group.append(svgElement('path', { class: `mark l${path.level}`, d: path.d }));
        path = { level, d: `M${at(stroke[index - 1])} L${at(stroke[index])}` };
      }
    }
    if (path) group.append(svgElement('path', { class: `mark l${path.level}`, d: path.d }));
  });
}

function drawLiveStroke(svg, stroke, limit) {
  const path = svg.querySelector('.stroke.live');
  if (path) path.setAttribute('d', strokePath(stroke, scaleFor(svg, limit)));
}

function drawNudges(group, nudges, scale) {
  nudges.forEach((nudge) => {
    const startX = scale.xFor(nudge.x);
    const startY = scale.yFor(nudge.y);
    // On screen "up" is a smaller y, so the upward part of the direction is taken away.
    const tipX = startX + nudge.across * 26;
    const tipY = startY - nudge.up * 26;
    const head = [0.5, -0.5].map((turn) => {
      const backX = -nudge.across * Math.cos(turn) - nudge.up * Math.sin(turn);
      const backY = nudge.up * Math.cos(turn) - nudge.across * Math.sin(turn);
      return `M${tipX.toFixed(1)} ${tipY.toFixed(1)} l${(backX * 9).toFixed(1)} ${(backY * 9).toFixed(1)}`;
    });
    group.append(svgElement('path', {
      class: 'nudge',
      d: `M${startX.toFixed(1)} ${startY.toFixed(1)} L${tipX.toFixed(1)} ${tipY.toFixed(1)} ${head.join(' ')}`
    }));
  });
}

function curvePaths(curve, scale, limit) {
  const xForColumn = (column) => scale.xFor((column / (curve.length - 1)) * 2 * limit - limit);
  const paths = [];
  let current = null;

  curve.forEach((value, column) => {
    const previous = column > 0 ? curve[column - 1] : null;
    if (value === null) {
      current = null;
      return;
    }
    const point = `${xForColumn(column).toFixed(1)} ${scale.yFor(value).toFixed(1)}`;
    const joined = previous !== null;
    if (current === null || !joined) {
      current = paths.push(`M${point} L${point}`) - 1;
    } else {
      paths[current] += ` L${point}`;
    }
  });
  return paths;
}

function drawGraph(svg, picture, limit) {
  const scale = scaleFor(svg, limit);

  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${scale.size} ${scale.size}`);
  drawGrid(svg, scale, limit, picture.exits);

  if (picture.ghost) {
    const faded = svgElement('g', { class: 'faded' });
    drawMarked(faded, picture.ghost.strokes, picture.ghost.levels, scale);
    svg.append(faded);
  }

  const columnWidth = scale.size / Math.max(1, picture.missed.length - 1);
  picture.missed.forEach((isMissed, column) => {
    if (!isMissed) return;
    svg.append(svgElement('rect', {
      class: 'missed', x: column * columnWidth - columnWidth / 2, y: scale.size - 7, width: columnWidth + 0.5, height: 7
    }));
  });
  const rowHeight = scale.size / Math.max(1, picture.missedRows.length - 1);
  picture.missedRows.forEach((isMissed, row) => {
    if (!isMissed) return;
    svg.append(svgElement('rect', {
      class: 'missed', x: 0, y: scale.size - row * rowHeight - rowHeight / 2, width: 7, height: rowHeight + 0.5
    }));
  });

  if (picture.shown) {
    const group = svgElement('g', { class: picture.curve ? 'faded' : '' });
    drawMarked(group, picture.shown.strokes, picture.shown.levels, scale);
    if (!picture.curve) drawNudges(group, picture.shown.nudges, scale);
    svg.append(group);
  }
  picture.strokes.forEach((stroke, index) => {
    const live = index === picture.strokes.length - 1;
    svg.append(svgElement('path', { class: live ? 'stroke live' : 'stroke', d: strokePath(stroke, scale) }));
  });

  if (picture.curve) {
    const filter = svgElement('filter', {
      id: 'wobble', filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: scale.size, height: scale.size
    });
    filter.append(
      svgElement('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.022, numOctaves: 2, seed: 4, result: 'noise' }),
      svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: 11, xChannelSelector: 'R', yChannelSelector: 'G' })
    );
    const answer = svgElement('g', { filter: 'url(#wobble)' });

    picture.asymptotes.forEach((asymptote) => {
      const line = asymptote.kind === 'vertical'
        ? { x1: scale.xFor(asymptote.input), x2: scale.xFor(asymptote.input), y1: 0, y2: scale.size }
        : {
          x1: 0,
          x2: scale.size,
          y1: scale.yFor(asymptote.slope * -limit + asymptote.start),
          y2: scale.yFor(asymptote.slope * limit + asymptote.start)
        };
      answer.append(svgElement('line', { class: 'asymptote', ...line }));
    });
    picture.curve.forEach((branch) => curvePaths(branch, scale, limit).forEach((path) => {
      answer.append(svgElement('path', { class: 'truth', d: path }));
    }));
    svg.append(filter, answer);
  }

  picture.exits.forEach((exit) => {
    const x = exit.input === undefined ? null : scale.xFor(exit.input);
    const y = exit.output === undefined ? null : scale.yFor(exit.output);
    const edge = scale.size;
    const shapes = {
      top: `${x - 8},16 ${x + 8},16 ${x},3`,
      bottom: `${x - 8},${edge - 16} ${x + 8},${edge - 16} ${x},${edge - 3}`,
      left: `16,${y - 8} 16,${y + 8} 3,${y}`,
      right: `${edge - 16},${y - 8} ${edge - 16},${y + 8} ${edge - 3},${y}`
    };
    svg.append(svgElement('polygon', { class: 'exit', points: shapes[exit.side] }));
  });

  picture.dots.forEach(([x, y]) => {
    svg.append(svgElement('circle', { class: 'dot', cx: scale.xFor(x), cy: scale.yFor(y), r: 6 }));
  });

  if (picture.pen) {
    svg.append(svgElement('circle', {
      class: picture.pen.down ? 'pen down' : 'pen', cx: scale.xFor(picture.pen.x), cy: scale.yFor(picture.pen.y), r: 8
    }));
  }

  svg.setAttribute('aria-label', describeGraph(picture, limit));
}

function describeGraph(picture, limit) {
  const number = (value) => String(Math.round(value * 10) / 10).replace('-', '−');
  const exits = picture.exits.map((exit) => (exit.input === undefined
    ? `the ${exit.side} edge at y = ${number(exit.output)}`
    : `the ${exit.side} edge at x = ${number(exit.input)}`));
  const parts = [`Graph from −${limit} to ${limit}.`];
  if (picture.curve) {
    parts.push('The real curve is shown.');
  } else if (exits.length > 0) {
    parts.push(`The curve goes off ${exits.join(', ')}.`);
  } else {
    parts.push("The curve doesn't go off the graph.");
  }
  if (picture.dots.length > 0) parts.push(`Spots on the curve at ${picture.dots.map(([x, y]) => `(${number(x)}, ${number(y)})`).join(', ')}.`);
  if (picture.percent !== null) parts.push(`Your last attempt scored ${picture.percent}%.`);
  if (!picture.curve && (picture.missed.some(Boolean) || picture.missedRows.some(Boolean))) {
    parts.push('Grey bars on the edges show parts of the curve you have not drawn yet.');
  }
  return parts.join(' ');
}
