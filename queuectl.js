#!/usr/bin/env node

import {Command} from "commander";
import { insertJob, countState, listJobsByState, getJobById, updateJobState, db } from "./config/db.js";
import {randomUUID} from "crypto";
import { spawn } from "child_process";
import fs from "fs";

const program = new Command();
const WORKER_FILE = "./worker_pids.json"

program
.name("queuectl")
.description("CLI-based job queue system running in background")
.version("1.0.0");

//command: queuectl enqueue <JSON>

program
.command("enqueue <spectification>")
.description("Enqueue a new background job (Pass a valid JSON string as command)")
.action((jsonStr) => {
    try{
        const jobData = JSON.parse(jsonStr);

        if(!jobData.command) {
            console.error("Please enter a valid command for the job");
            process.exit(1);
        } 

        const job = {
            id: jobData.id || randomUUID(),
            command: jobData.command,
            max_retries: jobData.max_retries || 3,  
            state: "pending",
        };

        insertJob(job);
        console.log(`Job enqueued successfully: ${job.id}`);
    } catch(err) {
        console.error(`Please check the command and retry: `, err.message);
        process.exit(1);
    }
});

//command: queuectl status

program
.command("status")
.description("Retrieves the summary of all the jobs")
.action(() => {
    const rows = countState();

    if(!rows.length) {
        console.error("Jobs not found in the queue.");
        return;
    } 

    console.log("\nJob Summary below: \n");
    rows.forEach((r) => {
        console.log(`${r.state.padEnd(10)} : ${r.count}`);
    });
});

program
.command("list")
.description("List Jobs filtered by states of the jobs")
.option("--state <state>", "Filter by job state (pending, processing, completed, failed, dead)")
.action((options) => {
    const state = options.state;
    const validStates = ["pending", "processing", "completed", "failed", "dead"];

    if(!validStates.includes(state)) {
        console.error(`Found an invalid state ${state} . Valid options are as follows: ${validStates.join(", ")}`);
        process.exit(1);
    }

    try{
        const jobs = listJobsByState(state, 100, 0);

        if(!jobs.length) {
            console.log("No jobs found in state: ", state);
            return;
        }

        console.log(`\n Jobs in state ${state}: \n`);
        for(const job of jobs) {
            console.log(`Job ID: ${job.id}`);
            console.log(`   Command: ${job.command}`);
            console.log(`   Attempts: ${job.attempts}/${job.max_retries}`);
            console.log(`   Created At: ${job.created_at}`);
            console.log(`   Updated At: ${job.updated_at}`);
            console.log("-----------------------------------------------------------");
        }
    } catch(err) {
        console.error("Error occured: ", err.message);
        process.exit(1);
    }
})

const worker = program
.command("worker")
.description("Manage worker processes")

worker
.command("start")
.description("Start worker nodes")
.option("--count <n>", "Number of concurrent workers", "1")
.action(async (options) => {
    const count = parseInt(options.count, 10);

    if(isNaN(count) || count <= 0){
        console.error("Invalid count, please enter a valid positive number");
        process.exit(1);
    } 

    console.log(`Starting ${count} workers`);

    const workers = [];

    for(let i = 0; i<count; i++) {
        const workerProcess = spawn("node", ["./worker_entry.js", (i+1).toString()], {
            stdio: 'inherit',
        });

        workers.push(workerProcess.pid);
    }

    fs.writeFileSync(WORKER_FILE, JSON.stringify(workers, null, 2));
    console.log(`Saved ${workers.length} workers to the file ${WORKER_FILE}`);
    // await Promise.all(workers);        //wait for all workers to complete the job
});

worker
.command("stop")
.description("Stop all running workers gracefully")
.action(() => {
    if(!fs.existsSync(WORKER_FILE)) {
        console.log("No active workers found.");
        return;
    }

    const pids = JSON.parse(fs.readFileSync(WORKER_FILE, "utf-8"));
    console.log(`Stopping ${pids.length} workers`);

    pids.forEach((pid) => {
        try{
            process.kill(pid, "SIGINT");
            console.log(`Worker with PID: ${pid} terminated`);
        } catch(err) {
            console.warn(`Couldnt stop PID: ${pid} with an error message: ${err.message}`);
        }
    });

    fs.unlinkSync(WORKER_FILE);
    console.log(`All workers stopped and ${WORKER_FILE} has been removed. `);
})

const dlq = program
.command("dlq")
.description("Manage jobs in DLQ (Dead-Letter Queue)")

dlq
.command("list")
.description("Prints all the jobs in the DLQ (Dead-Letter Queue)")
.action(() => {
    const jobs = listJobsByState("dead", 100, 0);

    if(!jobs.length) {
        console.log(`No jobs found in DLQ`);
        return;
    }

    console.log(`\n Dead Letter Queue Jobs: \n`);
    for(const job of jobs) {
        console.log(`Job ID: ${job.id}`);
        console.log(`   Command: ${job.command}`);
        console.log(`   Attempts: ${job.attempts}/${job.max_retries}`);
        console.log(`   Created At: ${job.created_at}`);
        console.log(`   Updated At: ${job.updated_at}`);
        console.log("----------------------------------------------------------------------")
    }
})

dlq
.command("retry <jobId>")
.description("Retries a specific DLQ job by ID (moves it back to pending state)")
.action((jobId) => {
    const job = getJobById(jobId);

    if(!job) {
        console.log(`No Job present in DLQ with ID: ${jobId}`);
        process.exit(1);
    }

    if(job.state !== "dead") {
        console.error(`Job with ${jobId} is not currently present in DLQ, current state of ${jobId} is ${job.state}`);
        process.exit(1);
    }

    db.prepare(`
        UPDATE jobs SET state='pending', attempts=0, run_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ?    
    `).run(job.id);

    console.log(`Job ID: ${jobId} has been re-scheduled for processing`);
})

dlq
.command("retry-all")
.description("Retry all the jobs currently in the Dead-Letter Queue")
.action(() => {
    const jobs = listJobsByState("dead", 1000, 0);

    if(!jobs.length) {
        console.log(`No Jobs available in DLQ for retrying`);
        return;
    }

    for(const job of jobs) {
        db.prepare(`
            UPDATE jobs SET state='pending', attempts=0, run_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ?    
        `).run(job.id);
    }

    console.log(`Retried ${jobs.length} jobs from the DLQ`);
})

const config = program
.command("config")
.description("Manage queue configuration setting like retries and backoff etc.,")

config
.command("get [key]")
.description("Fetches the current value of the key")
.action((key) => {
    try{
        if(key) {
            const row = db.prepare("SELECT key, value FROM config WHERE key = ?").get(key);
            if(!row) {
                console.error(`No configuration found currently for ${key}`);
                process.exit(1);
            }

            console.log(`Key: ${key}, value: ${row.value}`);
        } else {
            const rows = db.prepare("SELECT key, value FROM config").get();
            if(!rows.length) {
                console.log("No configuration found.");
                return;
            } 

            console.log("Current configuration: \n");
            rows.forEach((row) => console.log(`Key: ${row.key}, value: ${row.value}\n`));
        }
    }catch(err) {
        console.error("Error occured while reading config: ", err.message);
        process.exit(1);
    }
});

config
.command("set <key> <value>")
.description("Set or update a configuration setting e.g., (max_retries: 3)")
.action((key, value) => {
    try{
        db.prepare(
            `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
        ).run(key, value);

        console.log(`Updated the configuration ${key}: ${value}`);
    } catch(err) {
        console.error("Failed to update the configuration: ",err.message);
        process.exit(1);
    }
})

config
.command("delete <key>")
.description("Delete a configuration using key")
.action((key) => {
    try{
        const result = db.prepare("DELETE FROM config WHERE key = ?").run(key);

        if(result.changes === 0) {
            console.log(`No configuration for ${key} was changed.`);
        } else {
            console.log(`Deleted the configuration key: ${key}`);
        } 
    } catch(err) {
        console.error("Error while deleting the configuration", err.message);
        process.exit(1);
    }
})

program.parse(process.argv);