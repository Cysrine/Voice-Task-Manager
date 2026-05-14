import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const schema = `
-- tasks belong to a user
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  due_at      timestamptz,           -- nullable for "no time" tasks
  status      text not null default 'pending',  -- pending | done | cancelled
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- optional: conversation history for context
CREATE TABLE IF NOT EXISTS messages (
  id          uuid primary key default gen_random_uuid(),
  role        text not null,        -- 'user' | 'assistant'
  content     text not null,
  created_at  timestamptz default now()
);
`;

async function run() {
  try {
    await client.connect();
    console.log('Connected to database');
    await client.query(schema);
    console.log('Schema executed successfully');
  } catch (err) {
    console.error('Error executing schema', err);
  } finally {
    await client.end();
  }
}

run();
