const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const katex = require('katex');
const { all, initialiseDatabase, run } = require('./db');
const auth = require('./auth');
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
app.use('/katex', express.static(path.dirname(require.resolve('katex/dist/katex.min.js'))));
app.use('/api', (request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
app.use(auth.loadUser);

function formulaMath(machine, large) {
  return katex.renderToString(rules.describe(machine), {
    output: 'mathml', displayMode: large, throwOnError: false
  });
}

function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

// Counts recent requests for each key (an account, a username or an address).
// ponytail: the counts live in this server's memory, so they reset when it restarts and are not
// shared between servers. That is fine for one server; keep them in the database if that ever changes.
function limiter(most, minutes) {
  const recent = new Map();
  const cutoff = () => Date.now() - minutes * 60 * 1000;
  setInterval(() => {
    for (const [key, times] of recent) {
      const kept = times.filter((time) => time > cutoff());
      if (kept.length > 0) recent.set(key, kept);
      else recent.delete(key);
    }
  }, 60 * 1000).unref();
  return {
    full(key) {
      return (recent.get(key) || []).filter((time) => time > cutoff()).length >= most;
    },
    add(key) {
      recent.set(key, [...(recent.get(key) || []), Date.now()]);
    }
  };
}

// A whole classroom can share one address, so the limits per address are generous.
const wrongPasswords = limiter(5, 15);
const accountRequests = limiter(100, 15);
const playerMarking = limiter(60, 1);
const guestMarking = limiter(300, 1);

function limited(counter, keyOf, error) {
  return (request, response, next) => {
    const key = keyOf(request);
    if (counter.full(key)) return response.status(429).json({ error });
    counter.add(key);
    next();
  };
}

const limitAccounts = limited(accountRequests, (request) => request.ip,
  'There have been a lot of log ins from here recently, so wait a few minutes and try again.');
const limitMarking = (request, response, next) => (request.user
  ? limited(playerMarking, () => `user ${request.user.id}`, "You're going really fast, so wait a moment and try again.")
  : limited(guestMarking, () => request.ip, "You're going really fast, so wait a moment and try again."))(request, response, next);

function cleanText(value, longest) {
  return typeof value === 'string' ? value.trim().slice(0, longest) : '';
}

app.get('/api/me', (request, response) => {
  response.json({ user: request.user || null });
});

app.post('/api/signup', limitAccounts, route(async (request, response) => {
  const username = cleanText(request.body.username, 20).toLowerCase();
  const displayName = cleanText(request.body.displayName, 30) || username;
  const password = typeof request.body.password === 'string' ? request.body.password : '';

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return response.status(400).json({ error: 'Usernames need 3 to 20 letters, numbers or underscores.' });
  }
  if (password.length < 8 || password.length > 100) {
    return response.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }
  const taken = await all('SELECT id FROM users WHERE username = ?', [username]);
  if (taken.length > 0) {
    return response.status(409).json({ error: 'That username is taken.' });
  }

  const salt = auth.newSalt();
  const result = await run(
    'INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
    [username, displayName, auth.hashPassword(password, salt), salt]
  );
  await auth.startSession(response, result.id);
  response.status(201).json({ id: result.id });
}));

app.post('/api/login', limitAccounts, route(async (request, response) => {
  const username = cleanText(request.body.username, 20).toLowerCase();
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  if (wrongPasswords.full(username)) {
    return response.status(429).json({ error: 'Too many wrong passwords for this account, so wait 15 minutes and try again.' });
  }

  // The same message is used for a wrong username and a wrong password,
  // so nobody can use this form to find out which usernames exist.
  const users = await all('SELECT * FROM users WHERE username = ?', [username]);
  if (users.length === 0 || !auth.passwordMatches(password, users[0])) {
    wrongPasswords.add(username);
    return response.status(401).json({ error: 'Wrong username or password.' });
  }
  await run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  await auth.startSession(response, users[0].id);
  response.json({ id: users[0].id });
}));

app.post('/api/logout', route(async (request, response) => {
  await auth.endSession(request, response);
  response.status(204).end();
}));

async function findMachine(id) {
  const endless = /^r(\d{1,10})s([1234])$/.exec(id);
  if (endless) {
    const slot = Number(endless[2]);
    const machine = rules.machineFromSeed(Number(endless[1]), slot);
    return {
      ...machine,
      id,
      slot,
      endless: true,
      family_name: rules.FAMILIES[machine.family_id].name,
      family_description: rules.FAMILIES[machine.family_id].description,
      extra_name: machine.extra_family_id ? rules.FAMILIES[machine.extra_family_id].name : null
    };
  }

  const machines = await all(
    `${rules.MACHINE_SELECT} WHERE machines.id = ? AND machines.play_date <= ?`,
    [Number.parseInt(id, 10), rules.todayDate()]
  );
  return machines[0];
}

async function findPlay(userId, machineId) {
  const plays = await all('SELECT * FROM plays WHERE user_id = ? AND machine_id = ?', [userId, machineId]);
  return plays[0];
}

async function openPlay(userId, machine) {
  const earlier = await all(`
    SELECT machines.slot
    FROM machines
    LEFT JOIN plays ON plays.machine_id = machines.id AND plays.user_id = ?
    WHERE machines.play_date = ? AND machines.slot < ?
      AND (plays.id IS NULL OR plays.status = 'playing')
  `, [userId, machine.play_date, machine.slot]);
  if (earlier.length > 0) return { error: 'Finish the earlier curves first.' };

  await run('INSERT OR IGNORE INTO plays (user_id, machine_id) VALUES (?, ?)', [userId, machine.id]);
  const play = await findPlay(userId, machine.id);
  if (play.status !== 'playing') return { error: 'You already finished this curve.' };
  return { play };
}

function reveal(machine, accuracy, solved, goes, hints) {
  return { ...rules.revealed(machine, accuracy, solved, goes, hints), formulaMath: formulaMath(machine, true) };
}

async function savedState(userId, machine) {
  const play = await findPlay(userId, machine.id);
  if (!play) return null;

  const saved = {
    goes: play.goes,
    shape: play.hints > 0 ? rules.shapeOf(machine) : null,
    dots: rules.hintDots(machine).slice(0, Math.max(0, play.hints - 1)),
    result: null,
    last: null
  };
  if (play.status !== 'playing') {
    saved.result = reveal(machine, play.accuracy, play.status === 'solved', play.goes, play.hints);
  }
  const goes = await all('SELECT drawing FROM goes WHERE play_id = ? ORDER BY number DESC LIMIT 1', [play.id]);
  if (goes.length > 0) {
    const strokes = JSON.parse(goes[0].drawing);
    const marked = rules.judge(strokes, machine);
    saved.last = { strokes, levels: marked.levels, nudges: marked.nudges, missed: marked.missed, missedRows: marked.missedRows };
  }
  return saved;
}

function settings() {
  return {
    limit: rules.LIMIT,
    maxGoes: rules.MAX_GOES,
    maxHints: rules.MAX_HINTS,
    topScore: rules.TOP_SCORE,
    goPenalty: rules.GO_PENALTY,
    hintPenalty: rules.HINT_PENALTY,
    shortestStroke: rules.SHORTEST_STROKE,
    mostPoints: rules.MOST_POINTS
  };
}

async function sendDay(request, response, date) {
  const machines = await rules.machinesFor(date);
  const curves = [];
  for (const machine of machines) {
    curves.push({
      id: machine.id,
      slot: machine.slot,
      strokesPerGo: rules.pieces(machine),
      ink: rules.inkFor(machine),
      exits: rules.exits(machine),
      saved: request.user ? await savedState(request.user.id, machine) : null
    });
  }

  response.json({ date, today: date === rules.todayDate(), ...settings(), curves });
}

app.get('/api/today', route((request, response) => sendDay(request, response, rules.todayDate())));

app.get('/api/day/:date', route(async (request, response) => {
  const { date } = request.params;
  if (date !== rules.todayDate() && !rules.pastDates().includes(date)) {
    return response.status(404).json({ error: 'That day is not available.' });
  }
  return sendDay(request, response, date);
}));

app.get('/api/days', route(async (request, response) => {
  const dates = rules.pastDates();
  const played = request.user ? await all(`
    SELECT machines.play_date AS date, COUNT(*) AS finished, SUM(plays.score) AS points
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    WHERE plays.user_id = ? AND plays.status != 'playing' AND machines.play_date >= ?
    GROUP BY machines.play_date
  `, [request.user.id, dates[dates.length - 1]]) : [];
  response.json({
    days: dates.map((date) => {
      const row = played.find((item) => item.date === date);
      return { date, finished: row ? row.finished : 0, points: row ? row.points : 0 };
    })
  });
}));

app.get('/api/endless', route(async (request, response) => {
  const asked = Number.parseInt(request.query.slot, 10);
  const slot = [1, 2, 3, 4].includes(asked) ? asked : crypto.randomInt(1, 4);
  const seed = crypto.randomInt(1, 2000000000);
  const machine = rules.machineFromSeed(seed, slot);

  response.json({
    date: null,
    ...settings(),
    curves: [{
      id: `r${seed}s${slot}`,
      slot,
      strokesPerGo: rules.pieces(machine),
      ink: rules.inkFor(machine),
      exits: rules.exits(machine),
      saved: null
    }]
  });
}));

app.post('/api/machines/:id/go', limitMarking, route(async (request, response) => {
  const { drawing } = request.body;
  let { go, hints } = request.body;

  if (!rules.validDrawing(drawing)) {
    return response.status(400).json({ error: "That drawing didn't come through right." });
  }
  const machine = await findMachine(request.params.id);
  if (!machine) return response.status(404).json({ error: 'Curve not found.' });
  if (drawing.length > rules.pieces(machine)) {
    return response.status(400).json({ error: 'Too many strokes for this curve.' });
  }

  // The page stops the pen when the ink runs out. This catches a drawing sent some other way.
  if (rules.inkUsed(drawing) > rules.inkFor(machine) * 1.05) {
    return response.status(400).json({ error: 'That drawing used more ink than you have.' });
  }

  let play = null;
  if (request.user && !machine.endless) {
    const opened = await openPlay(request.user.id, machine);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    go = play.goes + 1;
    hints = play.hints;
  } else {
    if (!Number.isInteger(go) || go < 1 || go > rules.MAX_GOES) {
      return response.status(400).json({ error: 'That attempt number is not valid.' });
    }
    if (!Number.isInteger(hints) || hints < 0 || hints > rules.MAX_HINTS) {
      return response.status(400).json({ error: 'That number of hints is not valid.' });
    }
  }

  const reply = rules.markAttempt(drawing, machine, go, hints);
  if (reply.finished) reply.formulaMath = formulaMath(machine, true);

  if (play) {
    await run(
      'INSERT INTO goes (play_id, number, drawing, accuracy) VALUES (?, ?, ?, ?)',
      [play.id, go, JSON.stringify(drawing), reply.accuracy]
    );
    if (reply.finished) {
      await run(
        `UPDATE plays
         SET goes = ?, status = ?, accuracy = ?, score = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [go, reply.solved ? 'solved' : 'failed', reply.accuracy, reply.score, play.id]
      );
    } else {
      await run('UPDATE plays SET goes = ? WHERE id = ?', [go, play.id]);
    }
  }
  response.json(reply);
}));

app.post('/api/machines/:id/hint', limitMarking, route(async (request, response) => {
  const machine = await findMachine(request.params.id);
  if (!machine) return response.status(404).json({ error: 'Curve not found.' });

  let { number } = request.body;
  let play = null;
  if (request.user && !machine.endless) {
    const opened = await openPlay(request.user.id, machine);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    number = play.hints + 1;
  }
  if (!Number.isInteger(number) || number < 1 || number > rules.MAX_HINTS) {
    return response.status(400).json({ error: "You've used all your hints for this curve." });
  }

  if (play) await run('UPDATE plays SET hints = ? WHERE id = ?', [number, play.id]);
  response.json(rules.hintFor(machine, number));
}));

app.get('/api/families', route(async (_request, response) => {
  response.json(await all('SELECT id, name, difficulty, description FROM families ORDER BY id'));
}));

app.get('/api/history', auth.requireUser, route(async (request, response) => {
  const slot = Number.parseInt(request.query.slot, 10);
  const family = Number.parseInt(request.query.family, 10);
  const status = request.query.status;
  // Only these exact orderings can be used, so nothing typed into the address ends up in the SQL.
  const sortOptions = {
    newest: 'machines.play_date DESC, machines.slot ASC',
    oldest: 'machines.play_date ASC, machines.slot ASC',
    best: 'plays.score DESC, machines.play_date DESC',
    worst: 'plays.score ASC, machines.play_date DESC',
    goes: 'plays.goes ASC, plays.score DESC'
  };
  const orderBy = sortOptions[request.query.sort] || sortOptions.newest;

  const conditions = ['plays.user_id = ?', "plays.status != 'playing'"];
  const values = [request.user.id];
  if ([1, 2, 3].includes(slot)) {
    conditions.push('machines.slot = ?');
    values.push(slot);
  }
  if (Number.isInteger(family)) {
    conditions.push('(machines.family_id = ? OR machines.extra_family_id = ?)');
    values.push(family, family);
  }
  if (['solved', 'failed'].includes(status)) {
    conditions.push('plays.status = ?');
    values.push(status);
  }

  const rows = await all(`
    SELECT machines.play_date, machines.slot,
           machines.family_id, machines.a, machines.b, machines.c,
           machines.extra_family_id, machines.extra_a, machines.extra_b, machines.extra_c, machines.d,
           families.name AS family_name, extras.name AS extra_name,
           plays.status, plays.goes, plays.hints, plays.accuracy, plays.score
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    INNER JOIN families ON families.id = machines.family_id
    LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 200
  `, values);

  response.json(rows.map((row) => ({
    date: row.play_date,
    slot: row.slot,
    familyName: rules.kindName(row),
    formula: rules.describe(row),
    formulaMath: formulaMath(row, false),
    status: row.status,
    goes: row.goes,
    hints: row.hints,
    accuracy: row.accuracy,
    score: row.score
  })));
}));

function countStreaks(dates, today) {
  const dayNumbers = dates.map((date) => Math.floor(Date.parse(date) / 86400000));
  const todayNumber = Math.floor(Date.parse(today) / 86400000);
  let best = 0;
  let run = 0;
  let current = 0;

  dayNumbers.forEach((day, index) => {
    run = index > 0 && dayNumbers[index - 1] - day === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    if (index === run - 1 && todayNumber - dayNumbers[0] <= 1) current = run;
  });
  return { current, best };
}

app.get('/api/stats', auth.requireUser, route(async (request, response) => {
  const userId = request.user.id;

  const totals = await all(`
    SELECT COUNT(*) AS played,
           COALESCE(SUM(plays.status = 'solved'), 0) AS cracked,
           COALESCE(SUM(plays.score), 0) AS points,
           ROUND(AVG(plays.score)) AS average_score,
           MAX(plays.score) AS best_score,
           ROUND(AVG(plays.goes), 1) AS average_goes,
           COALESCE(SUM(plays.hints), 0) AS hints,
           COUNT(DISTINCT machines.play_date) AS days
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
  `, [userId]);

  const bestDay = await all(`
    SELECT machines.play_date AS date, SUM(plays.score) AS points
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY machines.play_date
    ORDER BY points DESC, machines.play_date DESC
    LIMIT 1
  `, [userId]);

  const byDifficulty = await all(`
    SELECT machines.slot,
           COUNT(*) AS played,
           SUM(plays.status = 'solved') AS cracked,
           ROUND(AVG(plays.score)) AS average_score,
           ROUND(AVG(plays.goes), 1) AS average_goes
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY machines.slot
    ORDER BY machines.slot
  `, [userId]);

  const byFamily = await all(`
    SELECT families.name,
           COUNT(plays.id) AS played,
           SUM(plays.status = 'solved') AS cracked,
           ROUND(AVG(plays.score)) AS average_score,
           MAX(plays.score) AS best_score
    FROM families
    INNER JOIN machines ON machines.family_id = families.id
    INNER JOIN plays ON plays.machine_id = machines.id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY families.id
    HAVING COUNT(plays.id) > 0
    ORDER BY average_score DESC
  `, [userId]);

  const days = await all(`
    SELECT DISTINCT machines.play_date AS date
    FROM plays
    INNER JOIN machines ON machines.id = plays.machine_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
      AND date(plays.finished_at, 'localtime') <= date(machines.play_date, '+1 day')
    ORDER BY machines.play_date DESC
  `, [userId]);

  response.json({
    totals: totals[0],
    bestDay: bestDay[0] || null,
    streak: countStreaks(days.map((row) => row.date), rules.todayDate()),
    byDifficulty,
    byFamily
  });
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Page not found.' });
});

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Something went wrong sending that, so try again.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'That drawing has too much detail, so try a simpler line.' });
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
