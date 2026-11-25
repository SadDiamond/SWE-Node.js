const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { all, run } = require('./db');
const curves = require('../public/curves');

// The maths is public so Endless can be played offline, so the daily curves also depend on a
// secret only the server knows. Without it anyone could work out tomorrow's curves in advance.
const secretPath = path.join(__dirname, '..', 'data', 'daily-secret');
function dailySecret() {
  if (process.env.DAILY_SECRET) return process.env.DAILY_SECRET;
  if (!fs.existsSync(secretPath)) {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('hex'));
  }
  return fs.readFileSync(secretPath, 'utf8').trim();
}
const SECRET = dailySecret();

// Builds one of the three curves for a date. slot is 1 (easy), 2 (medium) or 3 (hard).
function makeCurve(date, slot) {
  const digest = crypto.createHmac('sha256', SECRET).update(`${date} ${slot}`).digest();
  return curves.curveFromSeed(digest.readUInt32BE(0) % 2000000000, slot);
}

const CURVE_SELECT = `
  SELECT curves.*, curve_types.name AS type_name, curve_types.description AS type_description,
    curve_types.difficulty, extras.name AS extra_name
  FROM curves
  INNER JOIN curve_types ON curve_types.id = curves.type_id
  LEFT JOIN curve_types AS extras ON extras.id = curves.extra_type_id
`;

async function curvesFor(date) {
  for (const slot of [1, 2, 3]) {
    const made = makeCurve(date, slot);
    await run(
      `INSERT OR IGNORE INTO curves
         (play_date, slot, type_id, a, b, c, extra_type_id, extra_a, extra_b, extra_c, d)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, slot, made.type_id, made.a, made.b, made.c,
        made.extra_type_id, made.extra_a, made.extra_b, made.extra_c, made.d ?? null]
    );
  }
  return all(`${CURVE_SELECT} WHERE curves.play_date = ? ORDER BY curves.slot`, [date]);
}

async function fillHistory() {
  for (const date of [curves.todayDate(), ...curves.pastDates()]) await curvesFor(date);
}

module.exports = { ...curves, CURVE_SELECT, fillHistory, curvesFor, makeCurve };
