import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const migration = `
-- Add user_id to tasks so each task belongs to a user
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id) ON DELETE CASCADE;

-- Add user_id to messages so chat history is per-user
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id) ON DELETE CASCADE;

-- Indexes for fast per-user queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
`;

async function run() {
  try {
    await client.connect();
    console.log('Connected to database');
    await client.query(migration);
    console.log('Auth migration executed successfully');
  } catch (err) {
    console.error('Error executing migration', err);
  } finally {
    await client.end();
  }
}

run();
