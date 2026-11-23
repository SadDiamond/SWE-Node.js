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
   UPDATE families SET description = 'A perfectly round loop.' WHERE id = 15;`
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
  await exec(await fs.readFile(schemaPath, 'utf8'));

  if (!fresh) {
    for (let next = version + 1; next <= SCHEMA_VERSION; next += 1) {
      await exec(`BEGIN; ${UPGRADES[next - OLDEST_KEPT - 1]} PRAGMA user_version = ${next}; COMMIT;`);
    }
  }
  await run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

module.exports = { all, initialiseDatabase, run, SCHEMA_VERSION };
