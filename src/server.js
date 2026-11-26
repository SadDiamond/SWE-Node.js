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
app.use((request, _response, next) => {
  if (!request.body || typeof request.body !== 'object') request.body = {};
  next();
});

app.use((_request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
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

function formulaMath(curve, large) {
  return katex.renderToString(rules.describe(curve), {
    output: 'mathml', displayMode: large, throwOnError: false
  });
}

function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

// Counts recent requests for each key (an account, a username or an address).
// The counts are kept in memory, so they reset when the server restarts.
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

// A whole classroom can share one address. The limits per address are generous for that reason.
const wrongPasswords = limiter(5, 15);
const accountRequests = limiter(100, 15);
const playerMarking = limiter(60, 1);
const guestMarking = limiter(150, 1);

function limited(counter, keyOf, error) {
  return (request, response, next) => {
    const key = keyOf(request);
    if (counter.full(key)) return response.status(429).json({ error });
    counter.add(key);
    next();
  };
}

const limitAccounts = limited(accountRequests, (request) => request.ip,
  'There have been a lot of logins from here recently. Wait a few minutes and try again.');
const limitMarking = (request, response, next) => (request.user
  ? limited(playerMarking, () => `user ${request.user.id}`, "You're going really fast. Wait a moment and try again.")
  : limited(guestMarking, () => request.ip, "You're going really fast. Wait a moment and try again."))(request, response, next);

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
  if (password.length < 8) {
    return response.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }
  if (password.length > 100) {
    return response.status(400).json({ error: 'Passwords can be up to 100 characters long.' });
  }
  const taken = await all('SELECT id FROM users WHERE username = ?', [username]);
  if (taken.length > 0) {
    return response.status(409).json({ error: 'That username is taken.' });
  }

  const salt = auth.newSalt();
  const hash = await auth.hashPassword(password, salt);
  let result;
  try {
    result = await run(
      'INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
      [username, displayName, hash, salt]
    );
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return response.status(409).json({ error: 'That username is taken.' });
    throw error;
  }
  await auth.startSession(response, result.id);
  response.status(201).json({ id: result.id });
}));

app.post('/api/login', limitAccounts, route(async (request, response) => {
  const username = cleanText(request.body.username, 20).toLowerCase();
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  // Counted per address as well. Someone guessing from elsewhere can't lock the real owner out.
  const guessKey = `${username} ${request.ip}`;
  if (wrongPasswords.full(guessKey)) {
    return response.status(429).json({ error: 'Too many wrong passwords. Wait 15 minutes and try again.' });
  }

  // A wrong username and a wrong password get the same message. Nobody can use this form
  // to find out which usernames exist.
  const users = await all('SELECT * FROM users WHERE username = ?', [username]);
  if (!(await auth.passwordMatches(password, users[0]))) {
    wrongPasswords.add(guessKey);
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

async function findCurve(id) {
  const endless = /^r(\d{1,10})s([1234])$/.exec(id);
  if (endless) {
    const slot = Number(endless[2]);
    const curve = rules.curveFromSeed(Number(endless[1]), slot);
    return {
      ...curve,
      id,
      slot,
      endless: true,
      type_name: rules.TYPES[curve.type_id].name,
      type_description: rules.TYPES[curve.type_id].description,
      extra_name: curve.extra_type_id ? rules.TYPES[curve.extra_type_id].name : null
    };
  }

  const curves = await all(
    `${rules.CURVE_SELECT} WHERE curves.id = ? AND curves.play_date <= ?`,
    [Number.parseInt(id, 10), rules.todayDate()]
  );
  return curves[0];
}

async function findPlay(userId, curveId) {
  const plays = await all('SELECT * FROM plays WHERE user_id = ? AND curve_id = ?', [userId, curveId]);
  return plays[0];
}

async function openPlay(userId, curve) {
  const earlier = await all(`
    SELECT curves.slot
    FROM curves
    LEFT JOIN plays ON plays.curve_id = curves.id AND plays.user_id = ?
    WHERE curves.play_date = ? AND curves.slot < ?
      AND (plays.id IS NULL OR plays.status = 'playing')
  `, [userId, curve.play_date, curve.slot]);
  if (earlier.length > 0) return { error: 'Finish the earlier curves first.' };

  await run('INSERT OR IGNORE INTO plays (user_id, curve_id) VALUES (?, ?)', [userId, curve.id]);
  const play = await findPlay(userId, curve.id);
  if (play.status !== 'playing') return { error: "You've already finished this curve." };
  return { play };
}

function reveal(curve, accuracy, cracked, attempts, hints) {
  return { ...rules.revealed(curve, accuracy, cracked, attempts, hints), formulaMath: formulaMath(curve, true) };
}

async function savedState(userId, curve) {
  const play = await findPlay(userId, curve.id);
  if (!play) return null;

  const saved = {
    attempts: play.attempts,
    shape: play.hints > 0 ? rules.shapeOf(curve) : null,
    dots: rules.hintDots(curve).slice(0, Math.max(0, play.hints - 1)),
    result: null,
    last: null
  };
  if (play.status !== 'playing') {
    saved.result = reveal(curve, play.accuracy, play.status === 'cracked', play.attempts, play.hints);
  }
  const attempts = await all('SELECT drawing FROM attempts WHERE play_id = ? ORDER BY number DESC LIMIT 1', [play.id]);
  if (attempts.length > 0) {
    const strokes = JSON.parse(attempts[0].drawing);
    const marked = rules.judge(strokes, curve);
    saved.last = { strokes, levels: marked.levels, nudges: marked.nudges, missed: marked.missed, missedRows: marked.missedRows };
  }
  return saved;
}

function settings() {
  return {
    limit: rules.LIMIT,
    maxAttempts: rules.MAX_ATTEMPTS,
    maxHints: rules.MAX_HINTS,
    topScore: rules.TOP_SCORE,
    attemptPenalty: rules.ATTEMPT_PENALTY,
    hintPenalty: rules.HINT_PENALTY,
    shortestStroke: rules.SHORTEST_STROKE,
    mostPoints: rules.MOST_POINTS
  };
}

async function sendDay(request, response, date) {
  const curves = await rules.curvesFor(date);
  const shown = [];
  for (const curve of curves) {
    shown.push({
      id: curve.id,
      slot: curve.slot,
      strokesPerAttempt: rules.pieces(curve),
      ink: rules.inkFor(curve),
      exits: rules.exits(curve),
      start: rules.startDot(curve),
      saved: request.user ? await savedState(request.user.id, curve) : null
    });
  }

  response.json({ date, today: date === rules.todayDate(), ...settings(), curves: shown });
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
    SELECT curves.play_date AS date, COUNT(*) AS finished, SUM(plays.score) AS points
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    WHERE plays.user_id = ? AND plays.status != 'playing' AND curves.play_date >= ?
    GROUP BY curves.play_date
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
  const curve = rules.curveFromSeed(seed, slot);

  response.json({
    date: null,
    ...settings(),
    curves: [{
      id: `r${seed}s${slot}`,
      slot,
      strokesPerAttempt: rules.pieces(curve),
      ink: rules.inkFor(curve),
      exits: rules.exits(curve),
      start: rules.startDot(curve),
      saved: null
    }]
  });
}));

app.post('/api/curves/:id/attempts', limitMarking, route(async (request, response) => {
  let { attempt, hints } = request.body;

  if (!rules.validDrawing(request.body.drawing)) {
    return response.status(400).json({ error: "That drawing didn't come through properly. Try again." });
  }
  const drawing = rules.thinned(request.body.drawing);
  const curve = await findCurve(request.params.id);
  if (!curve) return response.status(404).json({ error: "We couldn't find that curve." });
  if (drawing.length > rules.pieces(curve)) {
    return response.status(400).json({ error: 'Too many strokes for this curve.' });
  }

  // The page stops the pen when the ink runs out. This catches a drawing sent some other way.
  if (rules.inkUsed(drawing) > rules.inkFor(curve) * 1.05) {
    return response.status(400).json({ error: 'That drawing used more ink than you have.' });
  }

  let play = null;
  if (request.user && !curve.endless) {
    const opened = await openPlay(request.user.id, curve);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    attempt = play.attempts + 1;
    hints = play.hints;
  } else {
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > rules.MAX_ATTEMPTS) {
      return response.status(400).json({ error: "That attempt didn't work. Try reloading the page." });
    }
    if (!Number.isInteger(hints) || hints < 0 || hints > rules.MAX_HINTS) {
      return response.status(400).json({ error: 'Something went wrong with that hint. Try reloading the page.' });
    }
  }

  const reply = rules.markAttempt(drawing, curve, attempt, hints);
  // A guest picks their own attempt number, so they could skip straight to the last one.
  // Today's answer is kept back from guests who didn't crack it until the day is over.
  const keepBack = !request.user && !curve.endless && curve.play_date === rules.todayDate() && !reply.cracked;
  if (reply.finished && keepBack) {
    for (const key of ['curve', 'formula', 'typeName']) delete reply[key];
    reply.asymptotes = [];
    reply.keptBack = true;
  } else if (reply.finished) {
    reply.formulaMath = formulaMath(curve, true);
  }

  if (play) {
    await run(
      'INSERT INTO attempts (play_id, number, drawing, accuracy) VALUES (?, ?, ?, ?)',
      [play.id, attempt, JSON.stringify(drawing), reply.accuracy]
    );
    if (reply.finished) {
      await run(
        `UPDATE plays
         SET attempts = ?, status = ?, accuracy = ?, score = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [attempt, reply.cracked ? 'cracked' : 'failed', reply.accuracy, reply.score, play.id]
      );
    } else {
      await run('UPDATE plays SET attempts = ? WHERE id = ?', [attempt, play.id]);
    }
  }
  response.json(reply);
}));

app.post('/api/curves/:id/hint', limitMarking, route(async (request, response) => {
  const curve = await findCurve(request.params.id);
  if (!curve) return response.status(404).json({ error: "We couldn't find that curve." });

  let { number } = request.body;
  let play = null;
  if (request.user && !curve.endless) {
    const opened = await openPlay(request.user.id, curve);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    number = play.hints + 1;
  }
  if (!Number.isInteger(number) || number < 1 || number > rules.MAX_HINTS) {
    return response.status(400).json({ error: "You've used all your hints for this curve." });
  }

  if (play) await run('UPDATE plays SET hints = ? WHERE id = ?', [number, play.id]);
  response.json(rules.hintFor(curve, number));
}));

app.get('/api/types', route(async (_request, response) => {
  response.json(await all('SELECT id, name, difficulty, description FROM curve_types ORDER BY id'));
}));

app.get('/api/history', auth.requireUser, route(async (request, response) => {
  const slot = Number.parseInt(request.query.slot, 10);
  const type = Number.parseInt(request.query.type, 10);
  const status = request.query.status;
  // Only these exact orderings can be used, so nothing typed into the address ends up in the SQL.
  const sortOptions = {
    newest: 'curves.play_date DESC, curves.slot ASC',
    oldest: 'curves.play_date ASC, curves.slot ASC',
    best: 'plays.score DESC, curves.play_date DESC',
    worst: 'plays.score ASC, curves.play_date DESC',
    attempts: 'plays.attempts ASC, plays.score DESC'
  };
  const orderBy = sortOptions[request.query.sort] || sortOptions.newest;

  const conditions = ['plays.user_id = ?', "plays.status != 'playing'"];
  const values = [request.user.id];
  if ([1, 2, 3].includes(slot)) {
    conditions.push('curves.slot = ?');
    values.push(slot);
  }
  if (Number.isInteger(type)) {
    conditions.push('(curves.type_id = ? OR curves.extra_type_id = ?)');
    values.push(type, type);
  }
  if (['cracked', 'failed'].includes(status)) {
    conditions.push('plays.status = ?');
    values.push(status);
  }

  const rows = await all(`
    SELECT curves.play_date, curves.slot,
           curves.type_id, curves.a, curves.b, curves.c,
           curves.extra_type_id, curves.extra_a, curves.extra_b, curves.extra_c, curves.d,
           curve_types.name AS type_name, extras.name AS extra_name,
           plays.status, plays.attempts, plays.hints, plays.accuracy, plays.score
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    INNER JOIN curve_types ON curve_types.id = curves.type_id
    LEFT JOIN curve_types AS extras ON extras.id = curves.extra_type_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 200
  `, values);

  response.json(rows.map((row) => ({
    date: row.play_date,
    slot: row.slot,
    typeName: rules.typeName(row),
    formula: rules.describe(row),
    formulaMath: formulaMath(row, false),
    status: row.status,
    attempts: row.attempts,
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
           COALESCE(SUM(plays.status = 'cracked'), 0) AS cracked,
           COALESCE(SUM(plays.score), 0) AS points,
           ROUND(AVG(plays.score)) AS average_score,
           MAX(plays.score) AS best_score,
           ROUND(AVG(plays.attempts), 1) AS average_attempts,
           COALESCE(SUM(plays.hints), 0) AS hints,
           COUNT(DISTINCT curves.play_date) AS days
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
  `, [userId]);

  const bestDay = await all(`
    SELECT curves.play_date AS date, SUM(plays.score) AS points
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY curves.play_date
    ORDER BY points DESC, curves.play_date DESC
    LIMIT 1
  `, [userId]);

  const byDifficulty = await all(`
    SELECT curves.slot,
           COUNT(*) AS played,
           SUM(plays.status = 'cracked') AS cracked,
           ROUND(AVG(plays.score)) AS average_score,
           ROUND(AVG(plays.attempts), 1) AS average_attempts
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY curves.slot
    ORDER BY curves.slot
  `, [userId]);

  const byType = await all(`
    SELECT curve_types.name,
           COUNT(plays.id) AS played,
           SUM(plays.status = 'cracked') AS cracked,
           ROUND(AVG(plays.score)) AS average_score,
           MAX(plays.score) AS best_score
    FROM curve_types
    INNER JOIN curves ON curves.type_id = curve_types.id
    INNER JOIN plays ON plays.curve_id = curves.id
    WHERE plays.user_id = ? AND plays.status != 'playing'
    GROUP BY curve_types.id
    HAVING COUNT(plays.id) > 0
    ORDER BY average_score DESC
  `, [userId]);

  const days = await all(`
    SELECT DISTINCT curves.play_date AS date
    FROM plays
    INNER JOIN curves ON curves.id = plays.curve_id
    WHERE plays.user_id = ? AND plays.status != 'playing'
      AND date(plays.finished_at, 'localtime') <= date(curves.play_date, '+1 day')
    ORDER BY curves.play_date DESC
  `, [userId]);

  response.json({
    totals: totals[0],
    bestDay: bestDay[0] || null,
    streak: countStreaks(days.map((row) => row.date), rules.todayDate()),
    byDifficulty,
    byType
  });
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: "We couldn't find that page." });
});

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Something went wrong sending that. Try again.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'That drawing has too much detail. Try a simpler line.' });
  }
  // Two of the same request at once (a double click) both pass the checks, then the database
  // refuses the second one. The page reloads on a 409 and shows what was saved.
  if (error.code === 'SQLITE_CONSTRAINT') {
    return response.status(409).json({ error: 'That was sent twice. Reload the page to see where you are.' });
  }
  console.error(error);
  response.status(500).json({ error: 'Something went wrong on our end. Try again.' });
});

initialiseDatabase()
  .then(() => rules.fillHistory())
  .then(() => app.listen(port, () => console.log(`Close Enough running at http://localhost:${port}`)))
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  });
