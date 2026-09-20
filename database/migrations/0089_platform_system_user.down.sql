-- Histories that name the platform actor keep their rows (ON DELETE RESTRICT),
-- so a reversal on a database the worker has run against fails, which is
-- the honest outcome.
DELETE FROM marketplace.users WHERE user_id = '01900000-0000-7000-8000-00000000c0de';
