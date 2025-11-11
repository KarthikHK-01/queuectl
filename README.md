# QueueCTL — CLI-Based Background Job Queue System

## Tech Stack
  Node.js - SQLite3 - Commander.js

## About the App
  QueueCTL is a lightweight, background job queue system build as a CLI tool. It supports various operations, like enqueueing shell commands as background jobs, parallel processing workers, automatic retries with exponential backoff (wait-time before trying again increases exponentially), a persistent storage layer using SQLite3 and also a DLQ (Dead-Letter Queue) to manage permanently failed jobs.

## System Overview
  Every job started with QueueCTL has 5 possible states:
  | **State**    | **Description**                     |
  | ------------ | ----------------------------------- |
  | `pending`    | Waiting to be picked up by a worker |
  | `processing` | Currently being executed            |
  | `completed`  | Successfully executed               |
  | `failed`     | Failed, but retryable               |
  | `dead`       | Permanently failed (moved to DLQ)   |

## Architecture Overview
  **Components:**
      SQLite Database - A file based persistent job storage (job + config) tables<br>
      CLI Tool - Manages all queue operations<br>
      Worker processes - Execute queued commands (jobs whose states are IN('pending', 'failed')) concurrently<br>
      DLQ system - Retains the list of permanently failed jobs for inspecting or retry<br>
      Config Manager - Configures the runtime parameters dynamically<br>

      Job Flow:
        Enqueue → Pending → Processing → [Completed | Failed → Retry → Dead]
        
## Installation and Setup
  **Clone this repository**
```bash
git clone https://github.com/KarthikHK-01/queuectl.git
cd queuectl
```

**Install dependencies**
```bash
npm install
```

**Link the CLI globally**
```bash
npm link
```
**Start using QueueCTL**
```bash
queuectl --help
```

## Usage examples
**Enqueues a job**
```bash
queuectl enqueue --% "{\"command\":\"echo Hello from QueueCTL\"}" //please provide the JSON object in according to the terminal you are using.
```
**Check job summary**
```bash
queuectl status
```

**Example output**<br>
```bash
Job Summary below:

  pending    : 2
  processing : 0
  completed  : 5
  failed     : 0
  dead       : 1
```

**List the jobs by state**
```bash
queuectl list --state pending
```

## Worker management
**Start workers**
```bash
queuectl workers start -- count 2
```
This spawns 2 concurrent worker processes. 

**Stopping the workers**
```bash
queuectl worker stop
```
Gracefully stops all active workers (but completes the jobs which are currently running before shutdown).

## Automatic Retry and Exponential Backoff
* Failed jobs are retried automatically
* Retry delay after delay given by the formula,
```bash
delay = base_backoff ^ attempts
```
* Example: 2s -> 4s -> 8s -> 16s ..
* After exceeding max_retries, jobs will be moved to DLQ.

## DLQ - Dead Letter Queue
**List Dead jobs**
```bash
queuectl dlq list
```

**Retry a specific job**
```bash
queuectl dlq retry <job-id>
```

**Retry all DLQ jobs**
```bash
queuectl dlq retry-all
```
All retried jobs are immediately set to pending.

## Configuration Management
**Manage global queue parameter using CLI*
**Get current config**
```bash
queuectl config get <key>
```
Prints the config (key, value) for a particular key.

**Set a config value**
```bash
queuectl config set <key> <value>
```
Sets the configuration for key-value pair.

**Delete a config**
```bash
queuectl config delete <key>
```
Deletes the configuration set for key.

## Database Schema
```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  command TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(state IN ('pending','processing','completed','failed','dead'))
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
```

## Test Scenarios

| **Scenario**             | **Expected Behavior**           |
| ------------------------ | ------------------------------- |
| Successful job execution | Moves to `completed`            |
| Invalid command          | Retries with backoff → DLQ      |
| Multiple workers         | Process jobs concurrently       |
| Worker stop              | Graceful exit after current job |
| Restart after crash      | Jobs persist in DB              |
| DLQ retry                | Job reappears as `pending`      |


## Assumptions and tradeoffs
* SQLite used for persistence for simplicity (no external dependencies).
* Backoff formula uses exponential base^attempts pattern.
* Job priority and scheduling not implemented (can be future work).
* Worker concurrency managed via separate Node child processes.

## Project Structure
```bash
queuectl/
├── config/
│   └── db.js           # SQLite connection & schema setup
├── worker.js           # Worker loop and retry logic
├── worker_entry.js     # Worker process entry point
├── queuectl.js         # CLI commands (main entry)
├── package.json
└── flam.db             # SQLite database file
```

## Results and discussion
QueueCTL successfully implements all core job queue features required for a production-ready CLI system. It ensures fault tolerance through automatic retries, persistent storage, and a recoverable Dead Letter Queue. Graceful shutdowns and dynamic configuration management enhance operational reliability, while modular code structure allows easy extensions.

## Author
Karthik H Kademani
