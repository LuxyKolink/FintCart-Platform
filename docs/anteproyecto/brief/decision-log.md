# Decision Log

## Fintcart Platform — Decision Log

### Project Context

Distributed financial education platform built as a bachelor's thesis at a Colombian university. Microservices architecture using Go, NestJS (TypeScript), Rust, and Angular. Internal communication via gRPC and RabbitMQ. PostgreSQL per service. Redis for caching and token management.

### Documentation Strategy

- Docs-as-code approach — LaTeX source files version controlled in Git
- LaTeX compiled locally via Docker (no local TeX Live installation)
- A `.sh` and `.bat` script in the repo root to simplify the compile command across operating systems
- GitLab CI pipeline for LaTeX deferred until GitLab is actually running

### Version Control

- Currently working on GitHub — no changes to existing workflow
- GitLab CE planned for later — will import from GitHub non-destructively and mirror back to GitHub
- GitLab as canonical source of truth, GitHub as read-only mirror
- Decision deferred — GitHub continues as normal for now

### Infrastructure

Two Ubuntu Server 24.04.3 machines provided by the college, each with 4GB RAM, 2 cores, 80GB disk. SSH access available from both home and office.

**Machine 1 — Infrastructure layer**

- PostgreSQL (single instance initially, migrating to per-service later)
- Redis
- RabbitMQ
- Notification Service
- Audit Service

**Machine 2 — Application layer**

- Application Server / API Gateway
- Authentication Server
- Orchestrator
- User Service
- Learning Service (NestJS)
- Simulator Service (Rust)
- Frontend (Nginx)
- PostgreSQL instances per service (in final configuration)

### Testing Strategy

- No local VM — college servers are accessible from home so they serve as the direct test environment
- Start with single PostgreSQL instance, validate everything runs
- Progressively migrate each service to its own PostgreSQL instance
- Validate after each migration before moving to the next

### Deferred Topics

- GitLab CE setup and migration from GitHub
- Full database-per-service isolation in production configuration
- LunarVim setup
