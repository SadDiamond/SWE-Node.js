-- Every query the app runs, in the order they were added while building it.
-- They're commented out so this file can be kept as a record. To try one, uncomment it and run
--   sqlite3 data/app.db < database/queries.sql
-- The ? placeholders the app uses have been swapped for example values here.

-- 1. Accounts

-- Check a username is free before signing up (src/server.js, /api/signup)
-- SELECT id FROM users WHERE username = 'sam';

-- Make the account (src/server.js, /api/signup)
-- INSERT INTO users (username, display_name, password_hash, password_salt)
-- VALUES ('sam', 'Sam', '<128 hex characters>', '<32 hex characters>');

-- Look the account up when logging in (src/server.js, /api/login)
-- SELECT * FROM users WHERE username = 'sam';

-- Clear out sessions that have run out (src/server.js, /api/login)
-- DELETE FROM sessions WHERE expires_at <= datetime('now');

-- Start a session that lasts 30 days (src/auth.js)
-- INSERT INTO sessions (token, user_id, expires_at)
-- VALUES ('<64 hex characters>', 1, datetime('now', '+30 days'));

-- Find who is logged in from their cookie, joining sessions to users (src/auth.js)
-- SELECT users.id, users.username, users.display_name, users.created_at
-- FROM sessions
-- INNER JOIN users ON users.id = sessions.user_id
-- WHERE sessions.token = '<64 hex characters>' AND sessions.expires_at > datetime('now');

-- Log out (src/auth.js)
-- DELETE FROM sessions WHERE token = '<64 hex characters>';

-- 2. Curves

-- Every type of curve, for the History filter (src/server.js, /api/types)
-- SELECT id, name, difficulty, description FROM curve_types ORDER BY id;

-- Save a day's three curves. Days that are already saved are left alone (src/rules.js)
-- INSERT OR IGNORE INTO curves
--   (play_date, slot, type_id, a, b, c, extra_type_id, extra_a, extra_b, extra_c, d)
-- VALUES ('2026-11-23', 1, 4, 2, -1, 3, NULL, NULL, NULL, NULL, NULL);

-- A day's curves with their type names, using a second join for any extra shape (src/rules.js)
-- SELECT curves.*, curve_types.name AS type_name, curve_types.description AS type_description,
--   curve_types.difficulty, extras.name AS extra_name
-- FROM curves
-- INNER JOIN curve_types ON curve_types.id = curves.type_id
-- LEFT JOIN curve_types AS extras ON extras.id = curves.extra_type_id
-- WHERE curves.play_date = '2026-11-23'
-- ORDER BY curves.slot;

-- One curve, but never one from the future (src/server.js)
-- SELECT curves.*, curve_types.name AS type_name, curve_types.description AS type_description,
--   curve_types.difficulty, extras.name AS extra_name
-- FROM curves
-- INNER JOIN curve_types ON curve_types.id = curves.type_id
-- LEFT JOIN curve_types AS extras ON extras.id = curves.extra_type_id
-- WHERE curves.id = 7 AND curves.play_date <= '2026-11-23';

-- 3. Playing

-- Earlier curves that day still unfinished, so they have to be done first (src/server.js)
-- SELECT curves.slot
-- FROM curves
-- LEFT JOIN plays ON plays.curve_id = curves.id AND plays.user_id = 1
-- WHERE curves.play_date = '2026-11-23' AND curves.slot < 2
--   AND (plays.id IS NULL OR plays.status = 'playing');

-- Start playing a curve (src/server.js)
-- INSERT OR IGNORE INTO plays (user_id, curve_id) VALUES (1, 7);

-- Someone's play of a curve (src/server.js)
-- SELECT * FROM plays WHERE user_id = 1 AND curve_id = 7;

-- Save an attempt (src/server.js, /api/curves/:id/attempts)
-- INSERT INTO attempts (play_id, number, drawing, accuracy) VALUES (3, 1, '[[[-10,2],[-9.5,2.4]]]', 62);

-- Count the attempt while the curve is still going (src/server.js)
-- UPDATE plays SET attempts = 1 WHERE id = 3;

-- Finish the curve (src/server.js)
-- UPDATE plays
-- SET attempts = 2, status = 'found', accuracy = 91, score = 760, finished_at = CURRENT_TIMESTAMP
-- WHERE id = 3;

-- Use a hint (src/server.js, /api/curves/:id/hint)
-- UPDATE plays SET hints = 1 WHERE id = 3;

-- The last attempt, to show it again after a reload (src/server.js)
-- SELECT drawing FROM attempts WHERE play_id = 3 ORDER BY number DESC LIMIT 1;

-- 4. Past days

-- How many curves were finished on each of the last 30 days, and the points (src/server.js, /api/days)
-- SELECT curves.play_date AS date, COUNT(*) AS finished, SUM(plays.score) AS points
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing' AND curves.play_date >= '2026-10-25'
-- GROUP BY curves.play_date;

-- 5. History

-- Finished curves with filters and a sort (src/server.js, /api/history)
-- The app only adds the WHERE parts for the filters that are picked, and the sort comes
-- from a fixed list (newest, oldest, best, worst, attempts), never from what the browser sends.
-- SELECT curves.play_date, curves.slot,
--        curves.type_id, curves.a, curves.b, curves.c,
--        curves.extra_type_id, curves.extra_a, curves.extra_b, curves.extra_c, curves.d,
--        curve_types.name AS type_name, extras.name AS extra_name,
--        plays.status, plays.attempts, plays.hints, plays.accuracy, plays.score
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- INNER JOIN curve_types ON curve_types.id = curves.type_id
-- LEFT JOIN curve_types AS extras ON extras.id = curves.extra_type_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
--   AND curves.slot = 3
--   AND (curves.type_id = 15 OR curves.extra_type_id = 15)
--   AND plays.status = 'found'
-- ORDER BY plays.score DESC, curves.play_date DESC
-- LIMIT 200;

-- 6. Stats

-- Totals across everything someone has finished (src/server.js, /api/stats)
-- SELECT COUNT(*) AS played,
--        COALESCE(SUM(plays.status = 'found'), 0) AS found,
--        COALESCE(SUM(plays.score), 0) AS points,
--        ROUND(AVG(plays.score)) AS average_score,
--        MAX(plays.score) AS best_score,
--        ROUND(AVG(plays.attempts), 1) AS average_attempts,
--        COALESCE(SUM(plays.hints), 0) AS hints,
--        COUNT(DISTINCT curves.play_date) AS days
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing';

-- Best day, grouping each day's three curves together
-- SELECT curves.play_date AS date, SUM(plays.score) AS points
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY curves.play_date
-- ORDER BY points DESC, curves.play_date DESC
-- LIMIT 1;

-- How it's going on easy, medium and hard
-- SELECT curves.slot,
--        COUNT(*) AS played,
--        SUM(plays.status = 'found') AS found,
--        ROUND(AVG(plays.score)) AS average_score,
--        ROUND(AVG(plays.attempts), 1) AS average_attempts
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY curves.slot
-- ORDER BY curves.slot;

-- Each type of curve, best average first, leaving out types never played
-- SELECT curve_types.name,
--        COUNT(plays.id) AS played,
--        SUM(plays.status = 'found') AS found,
--        ROUND(AVG(plays.score)) AS average_score,
--        MAX(plays.score) AS best_score
-- FROM curve_types
-- INNER JOIN curves ON curves.type_id = curve_types.id
-- INNER JOIN plays ON plays.curve_id = curves.id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY curve_types.id
-- HAVING COUNT(plays.id) > 0
-- ORDER BY average_score DESC;

-- Days played on time, for working out streaks
-- SELECT DISTINCT curves.play_date AS date
-- FROM plays
-- INNER JOIN curves ON curves.id = plays.curve_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
--   AND date(plays.finished_at, 'localtime') <= date(curves.play_date, '+1 day')
-- ORDER BY curves.play_date DESC;

-- 7. Upgrading an older database (src/db.js, upgrade 12)

-- Table and column names
-- ALTER TABLE machines RENAME TO curves;
-- ALTER TABLE curves RENAME COLUMN family_id TO type_id;
-- ALTER TABLE curves RENAME COLUMN extra_family_id TO extra_type_id;
-- ALTER TABLE families RENAME TO curve_types;
-- ALTER TABLE goes RENAME TO attempts;

-- plays is rebuilt because SQLite can't change a CHECK rule in place, and 'solved' becomes 'cracked'
-- INSERT INTO plays_new (id, user_id, curve_id, status, attempts, hints, accuracy, score, started_at, finished_at)
--   SELECT id, user_id, machine_id, CASE status WHEN 'solved' THEN 'cracked' ELSE status END,
--          goes, hints, accuracy, score, started_at, finished_at
--   FROM plays;
-- DROP TABLE plays;
-- ALTER TABLE plays_new RENAME TO plays;

-- Upgrade 14 renames the 'cracked' status to 'found', rebuilding plays the same way
-- INSERT INTO plays_new SELECT id, user_id, curve_id, CASE status WHEN 'cracked' THEN 'found' ELSE status END,
--   attempts, hints, accuracy, score, started_at, finished_at FROM plays;
