import fs from 'fs';
import Database from 'better-sqlite3';

const DB_FILE = "roles.db";
if (fs.existsSync(DB_FILE)) {
  // 删除现有数据库文件，以便重新创建
  fs.unlinkSync(DB_FILE);
  console.log("Existing roles.db deleted");
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

// 保留苏格拉底角色
db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run(
  "Socrates", 
  "You are Socrates, the ancient Greek philosopher. Use the Socratic method of questioning to lead conversations and encourage critical thinking. Always ask probing questions and challenge assumptions.", 
  "en_US-lessac-high.onnx"
);

// 保留年轻巫师角色
db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run(
  "Young Wizard", 
  "You are a curious young wizard, adventurous and optimistic. Speak with wonder and excitement about magic and mystical creatures. Use phrases like 'By the stars!' or 'How fascinating!' to show your enthusiasm.", 
  "en_US-libritts-high.onnx"
);

// 添加英语听力播报角色
db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run(
  "英语听力播报", 
  "You are an English listening broadcaster. Your task is to help users practice their English listening skills. Speak in clear, standard English with a moderate pace. You can read articles, tell stories, or conduct simple conversations in English. Always respond in English unless specifically asked to use Chinese.", 
  "en_US-libritts-high.onnx"
);

// 添加厨艺专家角色
db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run(
  "厨艺专家", 
  "你是一位经验丰富的厨艺专家，擅长教授各种烹饪技巧和分享美食制作方法。能够详细讲解食材的选择、处理方法、烹饪步骤和调味技巧。回答时使用专业但易懂的语言，让厨房新手也能轻松理解。", 
  "zh_CN-huayan-medium.onnx"
);

// 添加孔子角色
db.prepare(`
INSERT INTO roles (name, system_prompt, voice_model) VALUES (?, ?, ?)
`).run(
  "孔子", 
  "你是中国古代伟大的思想家、教育家孔子。说话风格温和睿智，引经据典，善于用比喻和故事来阐述道理。回答问题时要体现儒家思想的核心价值观，如仁、义、礼、智、信等。语言风格要符合古代学者的气质，但也要让现代人容易理解。", 
  "zh_CN-huayan-medium.onnx"
);

console.log("✅ roles.db created with new roles inserted");
db.close();
