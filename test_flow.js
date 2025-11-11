import { spawn, execSync } from "child_process";
import { insertJob, countState, listJobsByState, db } from "./config/db.js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

console.log("\n🧪 Running Full QueueCTL Validation Suite...\n");

const queuectlPath = path.resolve("./queuectl.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const showSummary = () => {
  console.log("\n📊 Current Job State Summary:\n");
  const states = countState();
  if (!states.length) console.log("No jobs found.");
  else states.forEach((s) => console.log(`${s.state.padEnd(10)} : ${s.count}`));
};



const successJob = {
  id: randomUUID(),
  command: "echo Job executed successfully",
  max_retries: 2,
  state: "pending",
};

const failJob = {
  id: randomUUID(),
  command: "exit 1",
  max_retries: 2,
  state: "pending",
};

insertJob(successJob);
insertJob(failJob);

console.log("✅ Inserted test jobs into queue:");
console.log(` - Success Job: ${successJob.id}`);
console.log(` - Fail Job: ${failJob.id}`);



console.log("\n▶️  Starting 2 workers concurrently...\n");
const worker = spawn(
  "node",
  [queuectlPath, "worker", "start", "--count", "2"],
  {
    stdio: "inherit",
  }
);

await sleep(8000); 



console.log("\n🛑 Stopping all workers gracefully...\n");
spawn("node", [queuectlPath, "worker", "stop"]);

await sleep(2000);
showSummary();



const dlqJobs = listJobsByState("dead", 10, 0);
if (dlqJobs.length) {
  console.log(`\n💀 Found ${dlqJobs.length} job(s) in DLQ. Retrying them...\n`);

  dlqJobs.forEach((job) => {
    db.prepare(
      `
      UPDATE jobs
      SET state = 'pending',
          attempts = 0,
          run_at = datetime('now'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;
    `
    ).run(job.id);
  });

  console.log(`✅ Retried ${dlqJobs.length} DLQ job(s).`);
} else {
  console.log("\n✅ No jobs in DLQ — all executed successfully.");
}

await sleep(2000);
showSummary();

console.log("\n🔁 Restarting a worker to simulate recovery...\n");
const restartWorker = spawn(
  "node",
  [queuectlPath, "worker", "start", "--count", "1"],
  {
    stdio: "inherit",
  }
);

await sleep(6000);
spawn("node", [queuectlPath, "worker", "stop"]);

await sleep(2000);
showSummary();
