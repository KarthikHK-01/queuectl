import Database from "better-sqlite3";

const db_file = './flam.db';
const db = new Database(db_file);

db.pragma('journal_mode = WAL');

const setupSQL = `
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY NOT NULL,
        command TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(state IN ('pending', 'processing', 'completed', 'failed', 'dead'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs (state, run_at)
    WHERE state = 'pending';

    CREATE TRIGGER IF NOT EXISTS trg_jobs_updated_at
    AFTER UPDATE ON jobs
    FOR EACH ROW
    BEGIN
        UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;


    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
    );

    INSERT INTO config (key, value)
    VALUES ('max_retries', '3')
    ON CONFLICT(key) DO NOTHING;
`;

db.exec(setupSQL);

const insertJobStatement = db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, run_at)
    VALUES (@id, @command, @state, @attempts, @max_retries, @created_at, @updated_at, @run_at);    
`);

const getJobByIdStatement = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
const listJobsByStateStatement = db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at LIMIT ? OFFSET ?`);
const listPendingStatement = db.prepare(`
    SELECT * FROM jobs
    WHERE state = 'pending' AND run_at <= datetime('now')
    ORDER BY run_at, created_at
    LIMIT ?
`);

const updateJobStateStatement =
    db.prepare(`UPDATE jobs SET state = @state, attempts = @attempts, run_at = @run_at, max_retries = @max_retries, command = @command, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id`);

const countStatement = db.prepare(`SELECT state, COUNT(*) as count FROM jobs GROUP BY state`);

export const insertJob = (job) => {
    const now = new Date().toISOString();
    const payload = {
        id: job.id,
        command: job.command,
        state: job.state || "pending",
        attempts: job.attempts ?? 0,
        max_retries: job.max_retries ?? 3,
        created_at: job.created_at || now,
        updated_at: job.updated_at || now,
        run_at: job.run_at || now,
    };

    return insertJobStatement.run(payload);
}

export const getJobById = (id) => {
    return getJobByIdStatement.get(id);
}

export const listJobsByState = (state = "pending", limit = 100, offset = 0) => {
    return listJobsByStateStatement.all(state, limit, offset);
}

export const listPending = (limit = 100) => {
    return listPendingStatement.all(limit);
}

export const updateJobState = (job) => {
    return updateJobStateStatement.run({
        id: job.id,
        state: job.state,
        attempts: job.attempts,
        run_at: job.run_at,
        max_retries: job.max_retries,
        command: job.command,
    });
}

export const countState = () => {
    return countStatement.all();
}

export const transaction = (fn) => {
    const tx = db.transaction(fn);
    return tx();
}

export {db};