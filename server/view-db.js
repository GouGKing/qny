import Database from "better-sqlite3";

const db = new Database("roles.db");

// 查询所有角色
const roles = db.prepare("SELECT * FROM roles").all();
console.log("数据库中的角色设置:");
roles.forEach((role, index) => {
  console.log(`\n角色 ${index + 1}:`);
  console.log(`ID: ${role.id}`);
  console.log(`名称: ${role.name}`);
  console.log(`系统提示: ${role.system_prompt}`);
  console.log(`语音模型: ${role.voice_model}`);
});

// 检查当前默认使用的角色(通常是ID=1)
const defaultRole = db.prepare("SELECT * FROM roles WHERE id = 1").get();
console.log("\n默认使用的角色(ID=1):");
console.log(`名称: ${defaultRole.name}`);
console.log(`系统提示: ${defaultRole.system_prompt}`);

// 关闭数据库连接
db.close();