const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
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

// 1. Read the Gemma API key from key.txt
let gemmaKey = '';
try {
  const keysPath = path.join(__dirname, 'key.txt');
  const keysContent = fs.readFileSync(keysPath, 'utf8');
  const match = keysContent.match(/Gemma:\s*(.+)/);
  if (match) {
    gemmaKey = match[1].trim();
  }
} catch (err) {
  console.error('Failed to read key.txt:', err.message);
}

if (!gemmaKey) {
  console.error('FATAL: Gemma API key not found in key.txt');
  process.exit(1);
}

// 2. Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: gemmaKey });

// 3. Optional: Store some basic conversation history to make it a continuous chat
// Note: In a real app, you'd store this per user/session.
let chatHistory = [];

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  console.log(`[USER]: ${message}`);

  // Append user message to history
  chatHistory.push({ role: 'user', parts: [{ text: message }] });

  try {
    const response = await ai.models.generateContent({
      model: 'gemma-4-31b-it',
      contents: chatHistory,
    });

    const reply = response.text;
    console.log(`[GEMMA]: ${reply}`);

    // Append model reply to history
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });

    res.json({ reply });
  } catch (error) {
    console.error('[ERROR] Failed to generate content:', error);
    // Remove the last user message if the call failed
    chatHistory.pop();
    res.status(500).json({ error: 'Failed to generate response' });
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
