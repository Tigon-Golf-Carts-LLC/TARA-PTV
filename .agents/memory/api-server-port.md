---
name: api-server stale port 8080
description: Recurring EADDRINUSE on the api-server workflow and how to clear it
---
The api-server workflow repeatedly fails with `EADDRINUSE 0.0.0.0:8080` because a previous node process stays orphaned on the port after restarts/merges.

**How to apply:** run `fuser -k 8080/tcp`, wait a second, then restart the `artifacts/api-server: API Server` workflow.
