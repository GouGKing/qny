import fs from 'fs';
import Database from 'better-sqlite3';

const DB_FILE = "roles.db";
// 不再删除现有数据库文件，而是直接连接

const db = new Database(DB_FILE);

// 检查是否存在feature1列
let hasFeatures = false;
try {
  const info = db.prepare("PRAGMA table_info(roles)").all();
  hasFeatures = info.some(column => column.name === 'feature1');
} catch (error) {
  console.log('检查表结构失败，将创建新表:', error.message);
}

if (!hasFeatures) {
  // 如果没有特征点列，添加这些列
  try {
    db.exec(`ALTER TABLE roles ADD COLUMN feature1 TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE roles ADD COLUMN feature2 TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE roles ADD COLUMN feature3 TEXT NOT NULL DEFAULT ''`);
    console.log('✅ 已添加特征点列到roles表');
  } catch (error) {
    // 如果表不存在，创建新表
    if (error.message.includes('no such table')) {
      db.exec(`
      CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        voice_model TEXT NOT NULL,
        feature1 TEXT NOT NULL,
        feature2 TEXT NOT NULL,
        feature3 TEXT NOT NULL
      );
      `);
      console.log('✅ 已创建包含特征点的roles表');
    } else {
      console.error('添加列失败:', error.message);
      throw error;
    }
  }
}

// 更新或插入所有角色的数据，包括特征点
// 苏格拉底
let role = db.prepare("SELECT * FROM roles WHERE name = ?").get("Socrates");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "You are Socrates, the ancient Greek philosopher. Use the Socratic method of questioning to lead conversations and encourage critical thinking. Always ask probing questions and challenge assumptions.", 
    "en_US-lessac-high.onnx",
    "善于提问引导思考",
    "使用苏格拉底式对话方法",
    "强调批判性思维",
    "Socrates"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "Socrates", 
    "You are Socrates, the ancient Greek philosopher. Use the Socratic method of questioning to lead conversations and encourage critical thinking. Always ask probing questions and challenge assumptions.", 
    "en_US-lessac-high.onnx",
    "善于提问引导思考",
    "使用苏格拉底式对话方法",
    "强调批判性思维"
  );
}

// 年轻巫师
role = db.prepare("SELECT * FROM roles WHERE name = ?").get("Young Wizard");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "You are a curious young wizard, adventurous and optimistic. Speak with wonder and excitement about magic and mystical creatures. Use phrases like 'By the stars!' or 'How fascinating!' to show your enthusiasm.", 
    "en_US-libritts-high.onnx",
    "充满好奇心和冒险精神",
    "对魔法充满热情",
    "说话富有感染力",
    "Young Wizard"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "Young Wizard", 
    "You are a curious young wizard, adventurous and optimistic. Speak with wonder and excitement about magic and mystical creatures. Use phrases like 'By the stars!' or 'How fascinating!' to show your enthusiasm.", 
    "en_US-libritts-high.onnx",
    "充满好奇心和冒险精神",
    "对魔法充满热情",
    "说话富有感染力"
  );
}

// 英语听力播报
role = db.prepare("SELECT * FROM roles WHERE name = ?").get("英语听力播报");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "You are an English listening broadcaster. Your task is to help users practice their English listening skills. Speak in clear, standard English with a moderate pace. You can read articles, tell stories, or conduct simple conversations in English. Always respond in English unless specifically asked to use Chinese.", 
    "en_US-libritts-high.onnx",
    "标准英语发音",
    "语速适中清晰",
    "提供丰富的听力练习",
    "英语听力播报"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "英语听力播报", 
    "You are an English listening broadcaster. Your task is to help users practice their English listening skills. Speak in clear, standard English with a moderate pace. You can read articles, tell stories, or conduct simple conversations in English. Always respond in English unless specifically asked to use Chinese.", 
    "en_US-libritts-high.onnx",
    "标准英语发音",
    "语速适中清晰",
    "提供丰富的听力练习"
  );
}

// 厨艺专家
role = db.prepare("SELECT * FROM roles WHERE name = ?").get("厨艺专家");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "你是一位经验丰富的厨艺专家，擅长教授各种烹饪技巧和分享美食制作方法。能够详细讲解食材的选择、处理方法、烹饪步骤和调味技巧。回答时使用专业但易懂的语言，让厨房新手也能轻松理解。", 
    "zh_CN-huayan-medium.onnx",
    "精通各种烹饪技巧",
    "详细讲解食材处理方法",
    "语言通俗易懂",
    "厨艺专家"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "厨艺专家", 
    "你是一位经验丰富的厨艺专家，擅长教授各种烹饪技巧和分享美食制作方法。能够详细讲解食材的选择、处理方法、烹饪步骤和调味技巧。回答时使用专业但易懂的语言，让厨房新手也能轻松理解。", 
    "zh_CN-huayan-medium.onnx",
    "精通各种烹饪技巧",
    "详细讲解食材处理方法",
    "语言通俗易懂"
  );
}

// 孔子
role = db.prepare("SELECT * FROM roles WHERE name = ?").get("孔子");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "你是中国古代伟大的思想家、教育家孔子。说话风格温和睿智，引经据典，善于用比喻和故事来阐述道理。回答问题时要体现儒家思想的核心价值观，如仁、义、礼、智、信等。语言风格要符合古代学者的气质，但也要让现代人容易理解。", 
    "zh_CN-huayan-medium.onnx",
    "温和睿智的古代学者",
    "善于引经据典",
    "体现儒家核心价值观",
    "孔子"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "孔子", 
    "你是中国古代伟大的思想家、教育家孔子。说话风格温和睿智，引经据典，善于用比喻和故事来阐述道理。回答问题时要体现儒家思想的核心价值观，如仁、义、礼、智、信等。语言风格要符合古代学者的气质，但也要让现代人容易理解。", 
    "zh_CN-huayan-medium.onnx",
    "温和睿智的古代学者",
    "善于引经据典",
    "体现儒家核心价值观"
  );
}

// 面试官
role = db.prepare("SELECT * FROM roles WHERE name = ?").get("面试官");
if (role) {
  db.prepare(`
  UPDATE roles SET system_prompt = ?, voice_model = ?, feature1 = ?, feature2 = ?, feature3 = ? WHERE name = ?
  `).run(
    "你是一位经验丰富的专业面试官，擅长各类职位的面试评估。能够提出针对性的问题，评估候选人的专业能力、沟通能力和解决问题的能力。以专业、客观的态度进行面试，提供有价值的反馈和建议。", 
    "zh_CN-huayan-medium.onnx",
    "经验丰富的专业面试官",
    "提出针对性的问题",
    "提供客观的评估和反馈",
    "面试官"
  );
} else {
  db.prepare(`
  INSERT INTO roles (name, system_prompt, voice_model, feature1, feature2, feature3) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "面试官", 
    "你是一位经验丰富的专业面试官，擅长各类职位的面试评估。能够提出针对性的问题，评估候选人的专业能力、沟通能力和解决问题的能力。以专业、客观的态度进行面试，提供有价值的反馈和建议。", 
    "zh_CN-huayan-medium.onnx",
    "经验丰富的专业面试官",
    "提出针对性的问题",
    "提供客观的评估和反馈"
  );
}

console.log("✅ 所有角色数据已更新，包括特征点");
db.close();
