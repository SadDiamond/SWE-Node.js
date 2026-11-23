const crypto = require('node:crypto');
const util = require('node:util');
const { all, run } = require('./db');

const SESSION_DAYS = 30;

// Passwords are never stored. Only a salted scrypt hash is kept, which cannot be turned back
// into the password. scrypt is slow on purpose, so guessing passwords takes a very long time.
const scrypt = util.promisify(crypto.scrypt);

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// Checking against a made-up account when the username doesn't exist takes just as long,
// so how fast the answer comes back doesn't give away which usernames are real.
const NOBODY = { password_salt: newSalt(), password_hash: '0'.repeat(128) };

async function passwordMatches(password, user) {
  const account = user || NOBODY;
  const given = Buffer.from(await hashPassword(password, account.password_salt), 'hex');
  const stored = Buffer.from(account.password_hash, 'hex');
  return crypto.timingSafeEqual(given, stored) && Boolean(user);
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || '').split('; ');
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

async function startSession(response, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    [token, userId]
  );
  response.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  });
}

async function endSession(request, response) {
  await run('DELETE FROM sessions WHERE token = ?', [readCookie(request, 'session')]);
  response.clearCookie('session');
}

async function loadUser(request, _response, next) {
  try {
    const token = readCookie(request, 'session');
    if (token) {
      const users = await all(`
        SELECT users.id, users.username, users.display_name, users.created_at
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ? AND sessions.expires_at > datetime('now')
      `, [token]);
      request.user = users[0];
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireUser(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Log in to do that.' });
  next();
}

module.exports = { endSession, hashPassword, loadUser, newSalt, passwordMatches, requireUser, startSession };
