import fs from "fs";
import Database from "better-sqlite3";

const DB_FILE = "roles.db";
if (fs.existsSync(DB_FILE)) {
  console.log("roles.db already exists");
  process.exit(0);
}

const db = new Database(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  voice_model TEXT NOT NULL
);
`);

db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run("Socrates", "You are Socrates, always ask questions and reason logically.", "en_US-libritts-high.onnx");

db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run("Young Wizard", "You are a curious young wizard, adventurous and optimistic.", "en_US-libritts-high.onnx");

console.log("✅ roles.db created and sample roles inserted");
db.close();
