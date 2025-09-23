import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import fetch from "node-fetch";

const db = new Database("roles.db");
const __dirname = path.resolve();

const wss = new WebSocketServer({ port: 3001 });
console.log("[Server] WebSocket running ws://localhost:3001");

// 调用 Ollama
async function chatWithOllama(systemPrompt, userInput) {
  try {
    console.log(`向Ollama发送请求 - 用户输入: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput }
        ],
        stream: false
      }),
    });
    
    if (!resp.ok) {
      console.error(`Ollama API 错误: ${resp.status} ${resp.statusText}`);
      return "抱歉，我暂时无法回答。";
    }
    
    const data = await resp.json();
    console.log("Ollama 响应数据:", JSON.stringify(data).substring(0, 100) + (JSON.stringify(data).length > 100 ? '...' : ''));
    
    // 增强的响应解析逻辑，处理各种可能的响应格式
    if (data?.message?.content) return data.message.content;
    if (data?.response) return data.response;
    if (data?.content) return data.content;
    
    console.warn("未识别的Ollama响应格式");
    return JSON.stringify(data);
  } catch (err) {
    console.error("Ollama调用错误:", err);
    return "抱歉，我暂时无法回答。";
  }
}

// 语音转文字
function transcribeBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(__dirname, "tmp_recv.wav");
    fs.writeFileSync(tmpFile, buffer);

    const whisperExec = path.join(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
    const whisper = spawn(whisperExec, [
      "-m", path.join(__dirname, "../whisper.cpp/models/ggml-base.en.bin"),
      "-f", tmpFile,
      "-otxt"
    ]);

    whisper.on("close", () => {
      const txtFile = tmpFile.replace(".wav", ".txt");
      let text = "";
      if (fs.existsSync(txtFile)) text = fs.readFileSync(txtFile, "utf-8").trim();
      resolve(text);
    });

    whisper.on("error", (err) => reject(err));
  });
}

// 调用 Piper TTS (使用修复后的tts.py)
function synthesizeSpeech(text) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(__dirname, "reply.wav");
    
    console.log(`[TTS] 正在调用TTS生成音频: "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`);

    // 调用修复后的tts.py，直接传递文本和输出文件路径
    const py = spawn("python", ["tts.py", text, outFile]);
    
    let stdout = "";
    let stderr = "";
    
    py.stdout.on("data", (d) => {
      const output = d.toString();
      stdout += output;
      console.log("tts:", output);
    });
    
    py.stderr.on("data", (d) => {
      const error = d.toString();
      stderr += error;
      console.error("tts err:", error);
    });

    py.on("close", (code) => {
      if (code !== 0) {
        console.error(`[Error] TTS处理失败，退出码: ${code}`);
        console.error(`stderr: ${stderr}`);
        
        // 如果TTS失败，生成一个简单的提示音作为后备
        if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
          generateBackupBeep(outFile);
        }
      }

      try {
        const audio = fs.readFileSync(outFile);
        console.log(`[Success] TTS音频生成成功，大小: ${audio.length} 字节`);
        resolve(audio);
      } catch (err) {
        console.error("[Error] 无法读取音频文件:", err);
        reject(err);
      }
    });
  });
}

// 生成后备提示音（当TTS失败时使用）
function generateBackupBeep(filePath) {
  const sampleRate = 44100;
  const frequency = 440; // 440Hz (A4音)
  const duration = 1; // 1秒
  const amplitude = 0.3; // 音量
  
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(numSamples * 2); // 16位PCM
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    const intSample = Math.floor(sample * 32767); // 转换为16位整数
    buffer.writeInt16LE(intSample, i * 2);
  }
  
  // 写入WAV文件头
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // 音频格式 (PCM)
  header.writeUInt16LE(1, 22); // 声道数 (单声道)
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // 字节率
  header.writeUInt16LE(2, 32); // 块对齐
  header.writeUInt16LE(16, 34); // 采样位数
  header.write('data', 36);
  header.writeUInt32LE(buffer.length, 40);
  
  // 组合头部和数据
  const wavFile = Buffer.concat([header, buffer]);
  fs.writeFileSync(filePath, wavFile);
  console.log("[Warning] 生成了后备提示音");
}

wss.on("connection", (ws) => {
  console.log("client connected");
  let role = db.prepare("SELECT * FROM roles WHERE id = 1").get();
  let chunks = [];

  ws.on("message", async (msg) => {
    console.log("收到客户端消息");
    let data;
    try {
      data = JSON.parse(msg.toString());
      console.log("解析消息成功", { type: data.type });
    } catch(e) {
      console.error("解析消息失败", e);
      data = null;
    }

    if (data && data.type === "config") {
      role = db.prepare("SELECT * FROM roles WHERE id = ?").get(data.roleId);
      console.log(`角色切换为: ${role.name}`);
      ws.send(JSON.stringify({ type:"info", msg:`角色切换：${role.name}` }));
    } else if (data && data.type === "text") {
      // 新增：处理纯文本消息
      console.log(`收到纯文本消息: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
      const userText = data.text;
      ws.send(JSON.stringify({ type:"user-text", text:userText }));

      const replyText = await chatWithOllama(role.system_prompt, userText);
      console.log(`AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);
      ws.send(JSON.stringify({ type:"reply-text", text:replyText }));

      const audioBuf = await synthesizeSpeech(replyText);
      ws.send(JSON.stringify({ type:"reply-audio", audio: audioBuf.toString("base64") }));
    } else if (data && data.type === "audio-chunk") {
      chunks.push(Buffer.from(data.chunk, "base64"));
    } else if (data && data.type === "stop") {
      const full = Buffer.concat(chunks);
      chunks = [];

      const userText = await transcribeBuffer(full);
      console.log(`语音转文字结果: ${userText}`);
      ws.send(JSON.stringify({ type:"user-text", text:userText }));

      const replyText = await chatWithOllama(role.system_prompt, userText);
      console.log(`AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);
      ws.send(JSON.stringify({ type:"reply-text", text:replyText }));

      const audioBuf = await synthesizeSpeech(replyText);
      ws.send(JSON.stringify({ type:"reply-audio", audio: audioBuf.toString("base64") }));
    }
  });

  ws.on("close", () => console.log("client disconnected"));
});
