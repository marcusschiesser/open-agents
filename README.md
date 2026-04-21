# Open Agents

This repository is based on Vercel's upstream Open Agents project:

- Upstream repo: https://github.com/vercel-labs/open-agents

This fork keeps the same general product idea and architecture, but is adapted to run without Vercel infrastructure.

## What changed from upstream

This fork replaces the Vercel-specific infrastructure pieces with locally runnable alternatives.

### 1. AI Gateway was replaced with direct model provider access

Instead of routing model calls through Vercel AI Gateway, this repo talks directly to model providers.

- OpenAI via `OPENAI_API_KEY`
- Anthropic via `ANTHROPIC_API_KEY`

You can provide either key or both. At least one is required if you want to run the agent.

### 2. Vercel Sandbox was replaced with Daytona

Instead of using Vercel Sandbox for the coding environment, this repo uses [Daytona](https://www.daytona.io/). 

Daytona provides the sandbox container where the agent can:

- read and write files
- run shell commands
- install dependencies
- start dev servers
- expose preview ports

### 3. Everything is wrapped in Docker Compose

This repo includes a `docker-compose.yml` that starts the app and all required local infrastructure together.

That includes:

- the Open Agents web app
- PostgreSQL for the app
- Daytona API, runner, proxy, and supporting services

The goal is to make local startup a single command instead of requiring Vercel services.

## Architecture

The core shape is still the same:

```text
Web -> Agent -> Sandbox
```

- `apps/web`: Next.js app and API routes
- `packages/agent`: agent runtime and tools
- `packages/sandbox`: sandbox abstraction and Daytona integration

## Running locally with Docker Compose

### Prerequisites

- Docker
- Docker Compose
- At least one model provider key:
  - `OPENAI_API_KEY`, or
  - `ANTHROPIC_API_KEY`

### 1. Export your API key

Example:

```bash
export OPENAI_API_KEY=your_openai_key
```

or:

```bash
export ANTHROPIC_API_KEY=your_anthropic_key
```

You can also put these in a local `.env` file that Docker Compose will read.

### 2. Start the stack

```bash
docker compose up -d --build
```

This starts the full local stack, including Daytona.

### 3. Open the app

Open:

- `http://localhost:3000`

Useful local endpoints:

- Open Agents web app: `http://localhost:3000`
- Daytona preview proxy: `http://localhost:4000`

### 4. Stop the stack

```bash
docker compose down
```

If you also want to remove volumes:

```bash
docker compose down -v
```

## Local development notes

- Local Docker Compose enables auth bypass for easier local testing.


