// test_flow.js
import { spawn } from "child_process";
import path from "path";

console.log("\nStarting QueueCTL Worker for Test Execution...\n");

const queuectlPath = path.resolve("./queuectl.js");

const worker = spawn(
  "node",
  [queuectlPath, "worker", "start", "--count", "1"],
  {
    stdio: "inherit", 
  }
);

process.on("SIGINT", () => {
  console.log("\nStopping test worker...\n");
  worker.kill("SIGINT");
  process.exit(0);
});

worker.on("exit", (code) => {
  console.log(`\nWorker exited with code ${code}\n`);
});
