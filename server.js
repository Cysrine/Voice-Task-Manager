const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
