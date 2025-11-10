import { startWorker } from "./worker.js";

const id = process.argv[2] || 1;

await startWorker(id);