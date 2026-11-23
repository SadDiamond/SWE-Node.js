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

-- Every type of curve, for the History filter (src/server.js, /api/families)
-- SELECT id, name, difficulty, description FROM families ORDER BY id;

-- Save a day's three curves; already-saved days are left alone (src/rules.js)
-- INSERT OR IGNORE INTO machines
--   (play_date, slot, family_id, a, b, c, extra_family_id, extra_a, extra_b, extra_c, d)
-- VALUES ('2026-11-23', 1, 4, 2, -1, 3, NULL, NULL, NULL, NULL, NULL);

-- A day's curves with their type names, using a second join for any extra shape (src/rules.js)
-- SELECT machines.*, families.name AS family_name, families.description AS family_description,
--   families.difficulty, extras.name AS extra_name
-- FROM machines
-- INNER JOIN families ON families.id = machines.family_id
-- LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
-- WHERE machines.play_date = '2026-11-23'
-- ORDER BY machines.slot;

-- One curve, but never one from the future (src/server.js)
-- SELECT machines.*, families.name AS family_name, families.description AS family_description,
--   families.difficulty, extras.name AS extra_name
-- FROM machines
-- INNER JOIN families ON families.id = machines.family_id
-- LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
-- WHERE machines.id = 7 AND machines.play_date <= '2026-11-23';

-- 3. Playing

-- Earlier curves that day still unfinished, so they have to be done first (src/server.js)
-- SELECT machines.slot
-- FROM machines
-- LEFT JOIN plays ON plays.machine_id = machines.id AND plays.user_id = 1
-- WHERE machines.play_date = '2026-11-23' AND machines.slot < 2
--   AND (plays.id IS NULL OR plays.status = 'playing');

-- Start playing a curve (src/server.js)
-- INSERT OR IGNORE INTO plays (user_id, machine_id) VALUES (1, 7);

-- Someone's play of a curve (src/server.js)
-- SELECT * FROM plays WHERE user_id = 1 AND machine_id = 7;

-- Save an attempt (src/server.js, /api/machines/:id/go)
-- INSERT INTO goes (play_id, number, drawing, accuracy) VALUES (3, 1, '[[[-10,2],[-9.5,2.4]]]', 62);

-- Count the attempt while the curve is still going (src/server.js)
-- UPDATE plays SET goes = 1 WHERE id = 3;

-- Finish the curve (src/server.js)
-- UPDATE plays
-- SET goes = 2, status = 'solved', accuracy = 91, score = 760, finished_at = CURRENT_TIMESTAMP
-- WHERE id = 3;

-- Use a hint (src/server.js, /api/machines/:id/hint)
-- UPDATE plays SET hints = 1 WHERE id = 3;

-- The last attempt, to show it again after a reload (src/server.js)
-- SELECT drawing FROM goes WHERE play_id = 3 ORDER BY number DESC LIMIT 1;

-- 4. Past days

-- How many curves were finished on each of the last 30 days, and the points (src/server.js, /api/days)
-- SELECT machines.play_date AS date, COUNT(*) AS finished, SUM(plays.score) AS points
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing' AND machines.play_date >= '2026-10-25'
-- GROUP BY machines.play_date;

-- 5. History

-- Finished curves with filters and a sort (src/server.js, /api/history)
-- The app only adds the WHERE parts for the filters that are picked, and the sort comes
-- from a fixed list (newest, oldest, best, worst, goes), never from what the browser sends.
-- SELECT machines.play_date, machines.slot,
--        machines.family_id, machines.a, machines.b, machines.c,
--        machines.extra_family_id, machines.extra_a, machines.extra_b, machines.extra_c, machines.d,
--        families.name AS family_name, extras.name AS extra_name,
--        plays.status, plays.goes, plays.hints, plays.accuracy, plays.score
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- INNER JOIN families ON families.id = machines.family_id
-- LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
--   AND machines.slot = 3
--   AND (machines.family_id = 15 OR machines.extra_family_id = 15)
--   AND plays.status = 'solved'
-- ORDER BY plays.score DESC, machines.play_date DESC
-- LIMIT 200;

-- 6. Stats

-- Totals across everything someone has finished (src/server.js, /api/stats)
-- SELECT COUNT(*) AS played,
--        COALESCE(SUM(plays.status = 'solved'), 0) AS cracked,
--        COALESCE(SUM(plays.score), 0) AS points,
--        ROUND(AVG(plays.score)) AS average_score,
--        MAX(plays.score) AS best_score,
--        ROUND(AVG(plays.goes), 1) AS average_goes,
--        COALESCE(SUM(plays.hints), 0) AS hints,
--        COUNT(DISTINCT machines.play_date) AS days
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing';

-- Best day, grouping each day's three curves together
-- SELECT machines.play_date AS date, SUM(plays.score) AS points
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY machines.play_date
-- ORDER BY points DESC, machines.play_date DESC
-- LIMIT 1;

-- How it's going on easy, medium and hard
-- SELECT machines.slot,
--        COUNT(*) AS played,
--        SUM(plays.status = 'solved') AS cracked,
--        ROUND(AVG(plays.score)) AS average_score,
--        ROUND(AVG(plays.goes), 1) AS average_goes
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY machines.slot
-- ORDER BY machines.slot;

-- Each type of curve, best average first, leaving out types never played
-- SELECT families.name,
--        COUNT(plays.id) AS played,
--        SUM(plays.status = 'solved') AS cracked,
--        ROUND(AVG(plays.score)) AS average_score,
--        MAX(plays.score) AS best_score
-- FROM families
-- INNER JOIN machines ON machines.family_id = families.id
-- INNER JOIN plays ON plays.machine_id = machines.id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
-- GROUP BY families.id
-- HAVING COUNT(plays.id) > 0
-- ORDER BY average_score DESC;

-- Days played on time, for working out streaks
-- SELECT DISTINCT machines.play_date AS date
-- FROM plays
-- INNER JOIN machines ON machines.id = plays.machine_id
-- WHERE plays.user_id = 1 AND plays.status != 'playing'
--   AND date(plays.finished_at, 'localtime') <= date(machines.play_date, '+1 day')
-- ORDER BY machines.play_date DESC;
