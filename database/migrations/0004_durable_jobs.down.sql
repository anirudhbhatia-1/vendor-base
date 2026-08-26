DROP TABLE IF EXISTS marketplace.job_recoveries;
DROP TABLE IF EXISTS marketplace.job_attempts;
DROP TABLE IF EXISTS marketplace.scheduled_jobs;
DROP FUNCTION IF EXISTS marketplace.protect_job_history();
DROP FUNCTION IF EXISTS marketplace.protect_scheduled_job_content();
