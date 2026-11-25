const path = require('node:path');
const express = require('express');
const { all, initialiseDatabase } = require('./db');
const rules = require('./rules');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use((_request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  next();
});
app.use(express.static(publicDirectory, { extensions: ['html'] }));

function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

app.get('/api/today', route(async (_request, response) => {
  const machines = await rules.machinesFor(rules.todayDate());
  response.json({
    date: rules.todayDate(),
    limit: rules.LIMIT,
    maxGoes: rules.MAX_GOES,
    maxHints: rules.MAX_HINTS,
    topScore: rules.TOP_SCORE,
    goPenalty: rules.GO_PENALTY,
    hintPenalty: rules.HINT_PENALTY,
    shortestStroke: rules.SHORTEST_STROKE,
    mostPoints: rules.MOST_POINTS,
    curves: machines.map((machine) => ({
      id: machine.id,
      slot: machine.slot,
      strokesPerGo: rules.pieces(machine),
      exits: rules.exits(machine)
    }))
  });
}));

app.post('/api/machines/:id/go', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const { drawing, go, hints } = request.body;

  if (!rules.validDrawing(drawing)) {
    return response.status(400).json({ error: "That drawing didn't come through right, so try again." });
  }
  if (!Number.isInteger(go) || go < 1 || go > rules.MAX_GOES) {
    return response.status(400).json({ error: "That attempt number doesn't look right." });
  }
  if (!Number.isInteger(hints) || hints < 0 || hints > rules.MAX_HINTS) {
    return response.status(400).json({ error: 'Something went wrong with that hint. Try reloading the page.' });
  }

  const machines = await all(`
    SELECT machines.*, families.name AS family_name
    FROM machines
    INNER JOIN families ON families.id = machines.family_id
    WHERE machines.id = ? AND machines.play_date <= ?
  `, [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: "We couldn't find that curve." });

  const machine = machines[0];
  const result = rules.judge(drawing, machine);
  const finished = result.solved || go === rules.MAX_GOES;

  const reply = {
    levels: result.levels,
    nudges: result.nudges,
    missed: result.missed,
    accuracy: result.accuracy,
    solved: result.solved,
    finished
  };
  if (finished) {
    reply.curve = rules.visibleCurve(machine);
    reply.score = rules.scoreFor(result.accuracy, go, hints);
    reply.familyName = machine.family_name;
    reply.formula = rules.describe(machine);
    reply.asymptotes = rules.asymptotes(machine);
  }
  response.json(reply);
}));

app.post('/api/machines/:id/hint', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const { number } = request.body;
  if (!Number.isInteger(number) || number < 1 || number > rules.MAX_HINTS) {
    return response.status(400).json({ error: "You've used all your hints for this curve." });
  }

  const machines = await all('SELECT * FROM machines WHERE id = ? AND play_date <= ?', [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: "We couldn't find that curve." });

  response.json({ dot: rules.hintDots(machines[0])[number - 1] });
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: "That page doesn't exist." });
});

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Something went wrong sending that, so try again.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'That drawing is too detailed to send, so try a simpler line.' });
  }
  console.error(error);
  response.status(500).json({ error: 'Something went wrong on our end, so try again.' });
});

initialiseDatabase()
  .then(() => rules.fillHistory())
  .then(() => app.listen(port, () => console.log(`Placeholder running at http://localhost:${port}`)))
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  });
