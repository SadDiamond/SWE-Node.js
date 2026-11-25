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

// Databases from before version 9 were made while the game itself was still changing shape,
// so they are cleared once and rebuilt. From version 9 on, changes are made in place below.
const OLDEST_KEPT = 9;

// Each change to an existing database, in order. A database at version 9 runs all of them,
// one at version 10 skips the first, and so on, so nobody's accounts or scores are lost.
// schema.sql always describes the latest tables, so a brand new database skips these.
const UPGRADES = [
  // 10: the V shape hint says which way it can point.
  `UPDATE families SET description = 'Two straight lines meeting at a sharp corner, pointing up or down.' WHERE id = 3;`,
  // 11: plainer descriptions for the hyperbolas and the circle.
  `UPDATE families SET description = 'Two separate pieces that get closer and closer to a vertical line and a flat line without touching them.' WHERE id = 8;
   UPDATE families SET description = 'Two pieces that get closer and closer to a vertical line and a sloping line.' WHERE id = 9;
   UPDATE families SET description = 'A perfectly round loop.' WHERE id = 15;`,
  // 12: tables and columns renamed to the words the site uses (curves, types of curve, attempts, cracked).
  // SQLite can't change a CHECK rule in place, so plays is copied into a new table and swapped over.
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
   ALTER TABLE plays_new RENAME TO plays;`
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

  // Upgrades run before schema.sql, which would otherwise make new empty tables beside the old ones.
  // Foreign keys are switched off while tables are swapped, so dropping the old plays table
  // doesn't also delete every attempt that points at it.
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
