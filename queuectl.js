import {Command} from "commander";
import { insertJob, countState } from "./config/db.js";
import {randomUUID} from "crypto";

const program = new Command();

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

program.parse(process.argv);