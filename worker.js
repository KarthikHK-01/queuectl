import {exec} from "child_process";
import {db, listPending, updateJobState, getJobById, getConfigValue} from "./config/db.js";
import { stderr } from "process";
import fs from "fs";

const base_backoff = Number(getConfigValue("base-backoff", 2));
const WORKER_FILE = "./worker_pids.json";

const commandRun = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, {shell:true}, (err, stdout, stderr) => {
            if(err) {
                reject({err, stdout, stderr}); 
            } else {
                resolve({stdout, stderr});
            }
        });
    });
}

const takeJob = () => {
    const selectStatement = db.prepare(`
        SELECT id FROM jobs WHERE state = 'pending' AND run_at <= datetime('now')
        ORDER BY run_at, created_at
        LIMIT 1;
    `);

    const updateStatement = db.prepare(`UPDATE jobs SET state = 'processing' WHERE id = ?;`);

    const getStatement = db.prepare(`SELECT * FROM jobs WHERE id = ?;`);

    const tx = db.transaction(() => {
        const row = selectStatement.get();
        // console.log("Querying for pending jobs, found:", row);
        if(!row) {
            return null;
        }

        updateStatement.run(row.id);
        return getStatement.get(row.id);
    });

    return tx();
}

const retryBackoff = (attempts) => {
    return Math.pow(base_backoff, attempts);
}

const handleJobFailure = (job) => {
    const attempts = job.attempts + 1;

    if(attempts <= job.max_retries) {
        const delay = retryBackoff(attempts);
        console.log(`Retrying Job in ${delay}s, (attempt ${attempts}/${job.max_retries})`);

        const update = db.prepare(`
            UPDATE jobs SET state = 'pending', attempts=?, run_at = datetime('now', '+' || ? || ' seconds'),
            updated_at = CURRENT_TIMESTAMP WHERE id = ?;
        `);

        update.run(attempts, delay, job.id);
    } else {
        console.log(`Job ${job.id} has reached maximum retries. It will be moved to DLQ (Dead Letter Queue)`);
        updateJobState({
            ...job,
            state: 'dead',
            attempts: attempts
        });
        process.exit(1);
    }
}

const processJob = async (workerId, job) => {
    console.log(`Worker ${workerId} picked up the job ${job.id}: ${job.command}`);
    try{
        const {stdout, stderr} = await commandRun(job.command);
        console.log(`Worker ${workerId} completed the job ${job.id} \n ${stdout}`);

        updateJobState({
            ...job,
            state: 'completed',
            attempts: job.attempts + 1,
            run_at: job.run_at,
        });
    } catch(err) {
        console.log(`Job ${job.id} failed due to ${err.error?.message || "unknown error"}`);
        handleJobFailure(job);
    }
}

export const startWorker = async (workerId) => {
    console.log(`Worker ${workerId} started. Waiting for arrival of jobs`);

    let stop = false;

    process.on("SIGINT", () => {
      console.log(`\n Worker ${workerId} Gracefully shutting down...`);
      //Removing worker_pids.json even if the workers were removed using Ctrl + C
      try {
        if (fs.existsSync(WORKER_FILE)) {
          const pids = JSON.parse(fs.readFileSync(WORKER_FILE, "utf-8"));
          const filtered = pids.filter((pid) => pid !== process.pid);

          if (filtered.length === 0) {
            fs.unlinkSync(WORKER_FILE);
            console.log(`PID file removed [No active workers left].`);
          } else {
            fs.writeFileSync(WORKER_FILE, JSON.stringify(filtered, null, 2));
            console.log(`Removed PID: ${process.pid} from PID JSON file`);
            fs.unlinkSync(WORKER_FILE);
          }
        }
      } catch (err) {
        console.error(`Error cleaning up the PID file: ${err.message}`);
      }
      stop = true;
    })

    while(!stop) {
        // console.log(`Worker ${workerId} checking for jobs...`);
        const job = takeJob();

        if(job) {
            // console.log(`Worker ${workerId} found job:`, job);
            await processJob(workerId, job);
        } else {
            // console.log(`Worker ${workerId} no jobs found, sleeping...`);
            await new Promise((res) => setTimeout(res, 2000));
        }
    }

    console.log(`Worker ${workerId} stopped working`);

    process.exit(0);
}