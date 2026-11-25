const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db');
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

let database;

function getDatabase() {
  if (database) return database;
  database = new sqlite3.Database(databasePath);
  // SQLite only enforces foreign keys when this is switched on for the connection.
  database.run('PRAGMA foreign_keys = ON');
  return database;
}

function run(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    getDatabase().run(sql, parameters, function onRun(error) {
      if (error) return reject(error);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    getDatabase().all(sql, parameters, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    getDatabase().exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

// Databases older than version 9 are cleared and rebuilt.
const OLDEST_KEPT = 9;

// A database from version 9 on runs each upgrade it hasn't had yet, in order, so accounts and
// scores are kept. A brand new database is made straight from schema.sql instead.
const UPGRADES = [
  // 10: V shape description
  `UPDATE families SET description = 'Two straight lines meeting at a sharp corner, pointing up or down.' WHERE id = 3;`,
  // 11: hyperbola, slanted hyperbola and circle descriptions
  `UPDATE families SET description = 'Two separate pieces that get closer and closer to a vertical line and a flat line without touching them.' WHERE id = 8;
   UPDATE families SET description = 'Two pieces that get closer and closer to a vertical line and a sloping line.' WHERE id = 9;
   UPDATE families SET description = 'A perfectly round loop.' WHERE id = 15;`,
  // 12: machines -> curves, families -> curve_types, goes -> attempts, 'solved' -> 'cracked'.
  // plays is rebuilt because SQLite can't change a CHECK rule in place.
  `ALTER TABLE machines RENAME TO curves;
   ALTER TABLE curves RENAME COLUMN family_id TO type_id;
   ALTER TABLE curves RENAME COLUMN extra_family_id TO extra_type_id;
   ALTER TABLE families RENAME TO curve_types;
   ALTER TABLE goes RENAME TO attempts;
   DROP INDEX IF EXISTS idx_machines_family;
   DROP INDEX IF EXISTS idx_goes_play;
   CREATE TABLE plays_new (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL,
     curve_id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'cracked', 'failed')),
     attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
     hints INTEGER NOT NULL DEFAULT 0 CHECK (hints BETWEEN 0 AND 3),
     accuracy INTEGER CHECK (accuracy BETWEEN 0 AND 100),
     score INTEGER CHECK (score BETWEEN 0 AND 1000),
     started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     finished_at TEXT,
     UNIQUE (user_id, curve_id),
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     FOREIGN KEY (curve_id) REFERENCES curves(id)
   );
   INSERT INTO plays_new (id, user_id, curve_id, status, attempts, hints, accuracy, score, started_at, finished_at)
     SELECT id, user_id, machine_id, CASE status WHEN 'solved' THEN 'cracked' ELSE status END,
            goes, hints, accuracy, score, started_at, finished_at
     FROM plays;
   DROP TABLE plays;
   ALTER TABLE plays_new RENAME TO plays;`,
  // 13: straight line, wave, cube root, exponential and S-curve descriptions
  `UPDATE curve_types SET description = 'It goes up or down by the same amount for every step across.' WHERE id = 1;
   UPDATE curve_types SET description = 'It rises and falls over and over in a regular pattern.' WHERE id = 5;
   UPDATE curve_types SET description = 'It looks like a sideways S that''s steep in the middle and flattens out on both sides.' WHERE id = 6;
   UPDATE curve_types SET description = 'It''s almost flat on one side and then shoots away faster and faster on the other.' WHERE id = 7;
   UPDATE curve_types SET description = 'It''s flat on one side, climbs or drops smoothly in the middle, and then goes flat again at a new level.' WHERE id = 11;`
];
const SCHEMA_VERSION = OLDEST_KEPT + UPGRADES.length;

async function initialiseDatabase() {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  // SQLite keeps a version number inside the database file.
  const [{ user_version: version }] = await all('PRAGMA user_version');
  const fresh = version < OLDEST_KEPT;
  if (fresh) {
    await exec('DROP TABLE IF EXISTS goes; DROP TABLE IF EXISTS plays; DROP TABLE IF EXISTS machines; DROP TABLE IF EXISTS families;');
  }

  // Upgrades run before schema.sql, otherwise it would create empty tables beside the ones being upgraded.
  // Foreign keys are off while plays is rebuilt, so dropping it doesn't delete its attempts.
  if (!fresh && version < SCHEMA_VERSION) {
    await exec('PRAGMA foreign_keys = OFF');
    for (let next = version + 1; next <= SCHEMA_VERSION; next += 1) {
      await exec(`BEGIN; ${UPGRADES[next - OLDEST_KEPT - 1]} PRAGMA user_version = ${next}; COMMIT;`);
    }
    await exec('PRAGMA foreign_keys = ON');
  }
  await exec(await fs.readFile(schemaPath, 'utf8'));
  await run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

module.exports = { all, initialiseDatabase, run, SCHEMA_VERSION };
