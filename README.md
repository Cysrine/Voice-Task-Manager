# UrbanGround Voice Task Manager

A voice-controlled task management web app. Speak naturally to create, update, and delete tasks. The AI assistant understands your intent, manages your to-do list, and talks back.

## Features

- **Voice Input & Output**: Real-time speech-to-text and text-to-speech powered by [Deepgram](https://deepgram.com/), with a Web Speech API fallback for TTS.
- **AI Task Management**: Natural-language commands are interpreted by a Groq-hosted LLM (Qwen 3 32B) that maps your speech to structured task actions (create / update / delete).
- **Confirmation Flow**: Destructive actions (update & delete) require spoken confirmation before executing.
- **Per-User Data**: Email/password authentication via [Better Auth](https://www.better-auth.com/) keeps every user's tasks and chat history private.
- **Persistent Storage**: Tasks and conversation history are stored in a [Neon](https://neon.tech/) serverless PostgreSQL database.
- **Deployable to Vercel**: Includes a `vercel.json` for one-click deployment as a serverless Node.js app.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Backend | Node.js, Express 5 |
| LLM | Groq API (Qwen 3 32B) |
| Speech-to-Text | Deepgram (WebSocket streaming) |
| Text-to-Speech | Deepgram Aura TTS (Web Speech API fallback) |
| Authentication | Better Auth (email/password) |
| Database | PostgreSQL on Neon (serverless) |
| Deployment | Vercel |

## Prerequisites

- **Node.js** v22.x (see `engines` in `package.json`)
- **npm** (bundled with Node.js)
- A [Neon](https://neon.tech/) PostgreSQL database
- API keys (see [Environment Variables](#environment-variables) below)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/UrbanGround.git
cd UrbanGround
```

### 2. Install dependencies

```bash
npm install
```

This will install the following packages:

| Package | Purpose |
|---|---|
| `express` | Web server & API routing |
| `groq-sdk` | Groq LLM client |
| `pg` | PostgreSQL driver |
| `better-auth` | Authentication (email/password) |
| `cors` | Cross-origin request handling |
| `dotenv` | Loads `.env` variables into `process.env` |

### 3. Set up environment variables

Create a `.env` file in the project root with the following keys:

```env
DEEPGRAM_KEY=your_deepgram_api_key
GROQ_KEY=your_groq_api_key
DATABASE_URL=your_neon_postgres_connection_string
BETTER_AUTH_SECRET=your_random_secret_string
BETTER_AUTH_URL=http://localhost:3000
```

#### Where to get each key

| Variable | Description | Where to get it |
|---|---|---|
| `DEEPGRAM_KEY` | API key for speech-to-text and text-to-speech | [Deepgram Console](https://console.deepgram.com/) create a free account and generate an API key |
| `GROQ_KEY` | API key for the Groq LLM inference API | [Groq Console](https://console.groq.com/) sign up and create an API key |
| `DATABASE_URL` | PostgreSQL connection string (with SSL) | [Neon Console](https://console.neon.tech/) create a project, then copy the connection string from the dashboard |
| `BETTER_AUTH_SECRET` | A random 256-bit hex string used to sign session cookies | Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_URL` | The base URL of your app | Use `http://localhost:3000` for local development |

### 4. Initialize the database

The setup requires a specific order because Better Auth auto-creates its own tables (`user`, `session`, `account`, `verification`) the first time the Express server starts.

```bash
# Step 1: Create the core tables (tasks, messages)
node db-init.js

# Step 2: Start the server once so Better Auth creates its auth tables
node server.js
# Wait until you see "Backend server listening on http://localhost:3000", then stop it (Ctrl+C)

# Step 3: Run the auth migration (adds user_id foreign keys to tasks & messages)
node db-migrate-auth.js
```

### 5. Start the development server

```bash
node server.js
```

The app will be available at **http://localhost:3000**.

- `/login.html` Sign up or sign in
- `/` Main voice task manager (requires authentication)

#### How authentication works

Better Auth runs **inside** the Express server as middleware. There is no separate auth server to start. When you run `node server.js`, the auth endpoints are automatically available under `/api/auth/*` (sign-up, sign-in, sign-out, session management). The configuration lives in `auth.js` and uses your `BETTER_AUTH_SECRET` and `DATABASE_URL` environment variables.

## Project Structure

```
UrbanGround/
├── server.js              # Express backend: API routes, Groq integration, auth middleware
├── auth.js                # Better Auth configuration
├── Text-Speech.html       # Main app UI: voice input, transcript display, TTS playback
├── login.html             # Authentication page (sign in / sign up)
├── db-init.js             # Database schema setup (tasks & messages tables)
├── db-migrate-auth.js     # Migration to add user_id columns & indexes
├── vercel.json            # Vercel deployment configuration
├── package.json           # Dependencies & project metadata
├── .env                   # Environment variables (not committed)
└── .gitignore             # Ignored files
```

## API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| `ALL` | `/api/auth/*` | — | Better Auth handles sign-up, sign-in, sessions |
| `GET` | `/api/config` | No | Returns the Deepgram key to the frontend |
| `POST` | `/api/chat` | Yes | Sends a voice transcript to the LLM and executes task actions |
| `POST` | `/api/tasks` | Yes | Create a task |
| `GET` | `/api/tasks` | Yes | List all tasks for the authenticated user |
| `PUT` | `/api/tasks/:id` | Yes | Update a task |
| `DELETE` | `/api/tasks/:id` | Yes | Delete a task |

## Deployment (Vercel)

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/).
3. Add all environment variables from your `.env` file to the Vercel project settings (set `BETTER_AUTH_URL` to your production URL).
4. Deployment, Vercel uses the included `vercel.json` to route API requests to `server.js` and serve the HTML pages as static files.
