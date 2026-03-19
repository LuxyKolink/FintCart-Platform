# Project Name

> One sentence describing what this system does.

## Overview

Brief description of the project's purpose, the problem it solves, and who it's for.

![System Overview](docs/diagrams/architecture/system-overview.svg)

## Documentation

| Document | Description |
|---|---|
| [Anteproyecto](docs/anteproyecto/anteproyecto.md) | Project proposal and scope |
| [System overview](docs/diagrams/architecture/system-overview.drawio) | High-level architecture |
| [Deployment diagram](docs/diagrams/architecture/deployment.drawio) | Infrastructure layout |

## Services

| Service | Responsibility | Diagrams |
|---|---|---|
| `auth-service` | Authentication & authorization | [view](docs/diagrams/services/auth-service/) |
| `order-service` | Order lifecycle management | [view](docs/diagrams/services/order-service/) |

## Repository structure

\```
your-monorepo/
├── docs/
│   ├── anteproyecto/
│   └── diagrams/
│       ├── architecture/
│       ├── services/
│       └── database/
├── services/
└── README.md
\```

## Getting started

### Prerequisites

- ...

### Setup

\```bash
git clone <https://github.com/your-org/your-repo.git>
cd your-repo
\```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---
Your Name · License · Year
