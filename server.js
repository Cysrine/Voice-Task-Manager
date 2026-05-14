const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const options = {
  index: 'Text-Speech.html' // Setting Text-Speech.html as the default page
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname, options)); // Serve static files from this directory

// 1. Read the Groq API key from key.txt
let groqKey = '';
try {
  const keysPath = path.join(__dirname, 'key.txt');
  const keysContent = fs.readFileSync(keysPath, 'utf8');
  const match = keysContent.match(/Groq:\s*(.+)/i);
  if (match) {
    groqKey = match[1].trim();
  }
} catch (err) {
  console.error('Failed to read key.txt:', err.message);
}

if (!groqKey) {
  console.error('FATAL: Groq API key not found in key.txt');
  process.exit(1);
}

// 2. Initialize the Groq client
const groq = new Groq({ apiKey: groqKey });

// 3. Optional: Store some basic conversation history to make it a continuous chat
// Note: In a real app, you'd store this per user/session.
let chatHistory = [];

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  console.log(`[USER]: ${message}`);

  try {
    // 1. Fetch current tasks
    const tasksResult = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    const tasks = tasksResult.rows;

    // 2. Build instructions
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
If the user requests to UPDATE or DELETE a task, you MUST set "needsConfirmation": true, and set "speak_text" to ask for explicit confirmation (e.g. "Should I delete the 10 AM task?"). Do NOT set needsConfirmation to true for create operations.
When the user confirms "yes" in the following turn, output the actions again but with "needsConfirmation": false.
For update_task, status, title, and due_at are optional and should only be included if they need to change.
If there are no actions to take, return an empty array for actions.`;

    const recentHistory = chatHistory.slice(-6);
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

    // Execute actions
    if (actionPlan.actions && Array.isArray(actionPlan.actions) && !actionPlan.needsConfirmation) {
      for (const action of actionPlan.actions) {
        if (action.type === 'create_task') {
          await pool.query('INSERT INTO tasks (title, due_at) VALUES ($1, $2)', [action.title, action.due_at || null]);
          console.log('Executed create_task:', action.title);
        } else if (action.type === 'update_task') {
          await pool.query(
            'UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title), due_at = COALESCE($3, due_at), updated_at = now() WHERE id = $4',
            [action.status || null, action.title || null, action.due_at || null, action.id]
          );
          console.log('Executed update_task:', action.id);
        } else if (action.type === 'delete_task') {
          await pool.query('DELETE FROM tasks WHERE id = $1', [action.id]);
          console.log('Executed delete_task:', action.id);
        }
      }
    }

    const speakText = actionPlan.speak_text || "I processed your request.";
    console.log(`[GROQ SPEAK]: ${speakText}`);

    // Update history
    chatHistory.push({ role: 'user', content: message });
    chatHistory.push({ role: 'assistant', content: speakText });

    res.json({ reply: speakText });
  } catch (error) {
    console.error('[ERROR] Failed to generate content or execute plan:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// --- Tasks API ---
// 1. Create a Task
app.post('/api/tasks', async (req, res) => {
  const { title, due_at } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO tasks (title, due_at) VALUES ($1, $2) RETURNING *',
      [title, due_at || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// 2. List Tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// 3. Update Task Status
app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { status, title, due_at } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title), due_at = COALESCE($3, due_at), updated_at = now() WHERE id = $4 RETURNING *',
      [status, title, due_at, id]
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
app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
