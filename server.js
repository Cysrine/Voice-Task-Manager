import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import 'dotenv/config';
import { Pool } from 'pg';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const __dirname = import.meta.dirname;

const options = {
  index: 'Text-Speech.html' // Setting Text-Speech.html as the default page
};

const app = express();
const allowedOrigins = [process.env.BETTER_AUTH_URL || 'http://localhost:3000'];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);
if (process.env.VERCEL_BRANCH_URL) allowedOrigins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) allowedOrigins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Better Auth must handle its own body parsing -- mount BEFORE express.json()
app.all('/api/auth/{*splat}', toNodeHandler(auth));

app.use(express.json());
app.use(express.static(__dirname, options));

// Auth middleware: verifies the session cookie via Better Auth
async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = session.user; // { id, name, email, ... }
    next();
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Read the Groq API key from environment variables
const groqKey = process.env.GROQ_KEY;

if (!groqKey) {
  console.error('FATAL: GROQ_KEY environment variable is not set');
  process.exit(1);
}

const groq = new Groq({ apiKey: groqKey });

// Endpoint to provide public config to the frontend (no auth needed)
app.get('/api/config', (req, res) => {
  res.json({
    deepgramKey: process.env.DEEPGRAM_KEY
  });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const userId = req.user.id;
  console.log(`[USER ${userId}]: ${message}`);

  try {
    // 1. Fetch current tasks for this user
    const tasksResult = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    const tasks = tasksResult.rows;

    // 2. Fetch recent chat history for this user from the database
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6',
      [userId]
    );
    const recentHistory = historyResult.rows.reverse(); // oldest first

    // 3. Build instructions
    const nowISO = new Date().toISOString();
    const systemPrompt = `You are a helpful task manager assistant.
The current date and time is: ${nowISO}. Use this to interpret relative times like "today", "tomorrow", or "5 PM".

Here is the user's current task list:
${JSON.stringify(tasks, null, 2)}

You must respond in JSON format ONLY matching exactly this schema:
{
  "speak_text": "The conversational reply to say out loud to the user",
  "needsConfirmation": false,
  "actions": [
    { "type": "create_task", "title": "...", "due_at": "..." },
    { "type": "update_task", "id": "uuid", "status": "done", "title": "...", "due_at": "..." },
    { "type": "delete_task", "id": "uuid" }
  ]
}
If the user's input is unintelligible noise, empty, or completely lacks meaning, respond exactly with "Sorry, I didn't quite catch that." in the speak_text and do not attempt to execute any actions.
If the user requests to UPDATE or DELETE a task, you MUST set "needsConfirmation": true, and set "speak_text" to ask for explicit confirmation (e.g. "Should I delete the 10 AM task?"). Do NOT set needsConfirmation to true for create operations.
When the user confirms "yes" in the following turn, output the actions again but with "needsConfirmation": false.
For update_task, status, title, and due_at are optional and should only be included if they need to change.
If there are no actions to take, return an empty array for actions.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message }
    ];

    const response = await groq.chat.completions.create({
      model: 'qwen/qwen3-32b',
      messages: messages,
      response_format: { type: 'json_object' }
    });

    const replyText = response.choices[0].message.content;
    console.log(`[GROQ RAW]: ${replyText}`);

    // Parse JSON
    let cleanedText = replyText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const actionPlan = JSON.parse(cleanedText);

    // Execute actions (scoped to this user)
    if (actionPlan.actions && Array.isArray(actionPlan.actions) && !actionPlan.needsConfirmation) {
      for (const action of actionPlan.actions) {
        if (action.type === 'create_task') {
          await pool.query(
            'INSERT INTO tasks (title, due_at, user_id) VALUES ($1, $2, $3)',
            [action.title, action.due_at || null, userId]
          );
          console.log('Executed create_task:', action.title);
        } else if (action.type === 'update_task') {
          await pool.query(
            'UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title), due_at = COALESCE($3, due_at), updated_at = now() WHERE id = $4 AND user_id = $5',
            [action.status || null, action.title || null, action.due_at || null, action.id, userId]
          );
          console.log('Executed update_task:', action.id);
        } else if (action.type === 'delete_task') {
          await pool.query(
            'DELETE FROM tasks WHERE id = $1 AND user_id = $2',
            [action.id, userId]
          );
          console.log('Executed delete_task:', action.id);
        }
      }
    }

    const speakText = actionPlan.speak_text || "I processed your request.";
    console.log(`[GROQ SPEAK]: ${speakText}`);

    // Persist chat history to the database (per-user)
    await pool.query(
      'INSERT INTO messages (role, content, user_id) VALUES ($1, $2, $3)',
      ['user', message, userId]
    );
    await pool.query(
      'INSERT INTO messages (role, content, user_id) VALUES ($1, $2, $3)',
      ['assistant', speakText, userId]
    );

    res.json({ reply: speakText });
  } catch (error) {
    console.error('[ERROR] Failed to generate content or execute plan:', error);
    res.status(500).json({ error: 'LLM Error' });
  }
});

// --- Tasks API (all protected, all scoped to the authenticated user) ---

// 1. Create a Task
app.post('/api/tasks', requireAuth, async (req, res) => {
  const { title, due_at } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO tasks (title, due_at, user_id) VALUES ($1, $2, $3) RETURNING *',
      [title, due_at || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// 2. List Tasks
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// 3. Update Task
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status, title, due_at } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title), due_at = COALESCE($3, due_at), updated_at = now() WHERE id = $4 AND user_id = $5 RETURNING *',
      [status, title, due_at, id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// 4. Delete Task
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
  });
}

export default app;
