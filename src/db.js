const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const databasePath = path.join(__dirname, '..', 'data', 'app.db');
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

let database;

function getDatabase() {
  if (database) return database;
  database = new sqlite3.Database(databasePath);
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

const SCHEMA_VERSION = 8;

function exec(sql) {
  return new Promise((resolve, reject) => {
    getDatabase().exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

async function initialiseDatabase() {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const version = await all('PRAGMA user_version');
  if (version[0].user_version !== SCHEMA_VERSION) {
    await exec(`
      DROP TABLE IF EXISTS attempts; DROP TABLE IF EXISTS goes; DROP TABLE IF EXISTS plays;
      DROP TABLE IF EXISTS curves; DROP TABLE IF EXISTS machines;
      DROP TABLE IF EXISTS curve_types; DROP TABLE IF EXISTS families;
    `);
  }

  await exec(await fs.readFile(schemaPath, 'utf8'));
  await run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

module.exports = { all, initialiseDatabase, run };
