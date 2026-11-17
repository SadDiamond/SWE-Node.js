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
function makeMachine(date, slot) {
  const digest = crypto.createHmac('sha256', SECRET).update(`${date} ${slot}`).digest();
  return curves.machineFromSeed(digest.readUInt32BE(0) % 2000000000, slot);
}

const MACHINE_SELECT = `
  SELECT machines.*, families.name AS family_name, families.description AS family_description,
    families.difficulty, extras.name AS extra_name
  FROM machines
  INNER JOIN families ON families.id = machines.family_id
  LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
`;

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
  for (const date of [curves.todayDate(), ...curves.pastDates()]) await machinesFor(date);
}

module.exports = { ...curves, MACHINE_SELECT, fillHistory, machinesFor, makeMachine };
