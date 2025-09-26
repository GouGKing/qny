import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import fetch from "node-fetch";

// 完整的日志记录器实现
const logger = {
  info: (...args) => console.log(`[INFO] ${args.join(' ')}`),
  error: (...args) => console.error(`[ERROR] ${args.join(' ')}`),
  debug: (...args) => console.log(`[DEBUG] ${args.join(' ')}
`),
  monitorWebSocketMessages: (ws) => {
    // 简单的WebSocket消息监控实现
    const originalSend = ws.send;
    ws.send = function(message, options, callback) {
      console.log(`[WebSocket] 发送消息: ${message.length > 100 ? message.substring(0, 100) + '...' : message}`);
      return originalSend.call(this, message, options, callback);
    };
  },
  monitorTranscribeBuffer: (transcribeFunc) => {
    // 监控语音转文字函数的执行
    return async (buffer) => {
      console.log(`[Transcribe] 开始处理音频，大小: ${buffer.length} 字节`);
      try {
        const startTime = Date.now();
        const result = await transcribeFunc(buffer);
        const endTime = Date.now();
        console.log(`[Transcribe] 转换完成，耗时: ${endTime - startTime}ms，结果长度: ${result.length} 字符`);
        return result;
      } catch (error) {
        console.error(`[Transcribe] 转换失败:`, error);
        throw error;
      }
    };
  }
};

const db = new Database("roles.db");
const __dirname = path.resolve();

const wss = new WebSocketServer({ port: 3001 });
console.log("[Server] WebSocket running ws://localhost:3001");

// 调用 Ollama
async function chatWithOllama(systemPrompt, userInput, isEnglishVoice = false) {
  try {
    console.log(`向Ollama发送请求 - 用户输入: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
    
    // 如果使用英文语音包，在系统提示中添加英文回复要求
    let finalSystemPrompt = systemPrompt;
    if (isEnglishVoice) {
      // 使用更强烈的指令，确保回复为英文
      finalSystemPrompt = `${systemPrompt}\n\n重要要求：请一定用英语回答，不要使用任何中文。所有回复内容必须是英文。`;
      console.log("[语言控制] 使用英文语音包，强制要求英文回复");
    }
    
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral",
        messages: [
          { role: "system", content: finalSystemPrompt },
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

// 语音转文字 - 修复版，集成详细日志
// 语音转文字 - 稳定版 (用 ffmpeg 转码)
function transcribeBuffer(buffer) {
  return new Promise((resolve, reject) => {
    try {
      const tmpRaw = path.join(__dirname, "tmp_recv_input"); // 原始文件
      const tmpWav = path.join(__dirname, "tmp_recv.wav");   // 转码后 wav

      // 保存客户端传来的 buffer（可能是 webm/ogg/pcm）
      fs.writeFileSync(tmpRaw, buffer);
      console.log(`[STT] 已保存原始音频: ${tmpRaw}, 大小 ${buffer.length} 字节`);

      // 调用 ffmpeg 转换成标准 wav
      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-i", tmpRaw,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        tmpWav
      ]);

      ffmpeg.stderr.on("data", (d) => console.log("[FFmpeg]", d.toString()));

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          console.error("[STT] ffmpeg 转码失败");
          return reject(new Error("ffmpeg 转码失败"));
        }
        console.log(`[STT] 转码完成: ${tmpWav}`);

        // whisper-cli 路径
        const whisperExec = path.join(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
        const modelPath   = path.join(__dirname, "../whisper.cpp/build/bin/Release/ggml-medium.bin");

        console.log(`[STT] 调用 Whisper: ${whisperExec}`);

        const whisper = spawn(whisperExec, [
          "-m", modelPath,
          "-otxt",
          "-l", "auto",       // 自动检测语言（中英混合）
          "-np",
          tmpWav
        ]);

        whisper.stdout.on("data", (d) => console.log("[Whisper]", d.toString()));
        whisper.stderr.on("data", (d) => console.error("[Whisper ERR]", d.toString()));

        whisper.on("close", () => {
          const txtFile = tmpWav + ".txt";
          if (fs.existsSync(txtFile)) {
            const text = fs.readFileSync(txtFile, "utf-8").trim();
            console.log(`[STT] 转文字成功: ${text}`);
            resolve(text);
          } else {
            console.error(`[STT] 未找到输出文件: ${txtFile}`);
            resolve("");
          }
        });

        whisper.on("error", (err) => {
          console.error("[STT] Whisper 调用错误:", err);
          reject(err);
        });
      });
    } catch (err) {
      console.error("[STT] 转文字处理错误:", err);
      reject(err);
    }
  });
}


// 调用 Piper TTS (使用修复后的tts.py)
function synthesizeSpeech(text, voiceModel = null) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(__dirname, "reply.wav");
    console.log(`[TTS] 正在调用TTS生成音频: "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`);
    console.log(`[TTS] 当前语音模型: ${voiceModel || '未指定'}`);
    
    // 构建命令参数，根据是否提供voiceModel决定是否添加第四个参数
    // 使用文件传递文本内容，避免命令行参数编码问题
    const textFile = path.join(__dirname, "tts_text.txt");
    fs.writeFileSync(textFile, text, 'utf-8');
    
    const args = ["tts.py", textFile, outFile];
    if (voiceModel) {
      args.push(voiceModel);
      console.log(`[TTS] 正在使用指定的语音模型: ${voiceModel}`);
    } else {
      console.log(`[TTS] 未指定语音模型，将使用tts.py的默认逻辑`);
    }
    
    // 调用tts.py，传递所有必要参数
    const py = spawn("python", args, { encoding: 'utf-8' });
    let stdout = "";
    let stderr = "";
    
    py.stdout.on("data", (d) => {
      const output = d.toString('utf-8');
      stdout += output;
      console.log("tts:", output);
    });
    
    py.stderr.on("data", (d) => {
      const error = d.toString('utf-8');
      stderr += error;
      console.error("tts err:", error);
    });
    
    py.on("close", (code) => {
      // 清理临时文本文件
      try {
        if (fs.existsSync(textFile)) {
          fs.unlinkSync(textFile);
        }
      } catch (err) {
        console.error(`[Error] 清理临时文本文件失败: ${err}`);
      }
      
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
  // 为每个连接生成唯一标识，用于调试
  const connectionId = Math.random().toString(36).substring(2, 10);
  console.log(`client connected [ID: ${connectionId}]`);
  // 设置默认角色（如果存在的话），避免未选择角色导致的错误
  let role = db.prepare("SELECT * FROM roles LIMIT 1").get();
  if (role) {
    console.log(`[${connectionId}] 已自动选择默认角色: ${role.name} [voice_model: ${role.voice_model}]`);
  } else {
    console.log(`[${connectionId}] 未找到默认角色，等待用户选择`);
    role = null;
  }
  let chunks = [];
  let isPlaying = false; // 新增：跟踪当前是否正在播放语音
  let pendingAudio = null; // 新增：存储暂停时的待播放音频

  // 使用监控版本的WebSocket消息处理
  logger.monitorWebSocketMessages(ws);

  // 新增：播放音频的函数，支持暂停/恢复
  function playAudio(audioData) {
    if (!isPlaying) {
      isPlaying = true;
      console.log(`[${connectionId}] 开始播放音频`);
      ws.send(JSON.stringify({ 
        type: "reply-audio", 
        audio: audioData, 
        isPaused: false 
      }));
    }
  }

  ws.on("message", async (msg) => {
    console.log(`[${connectionId}] 收到客户端消息`);
    let data;

    try {
      data = JSON.parse(msg.toString());
      console.log(`[${connectionId}] 解析消息成功`, { type: data.type });
    } catch(e) {
      console.error(`[${connectionId}] 解析消息失败`, e);
      data = null;
    }

    if (data && data.type === "config") {
      // 添加更详细的角色切换日志
      console.log(`[${connectionId}] 收到角色配置请求: roleId=${data.roleId}`);
      role = db.prepare("SELECT * FROM roles WHERE id = ?").get(data.roleId);
      if (role) {
        console.log(`[${connectionId}] 角色切换为: ${role.name} [voice_model: ${role.voice_model}]`);
        ws.send(JSON.stringify({ 
          type: "info", 
          msg: `角色切换：${role.name}` 
        }));
      } else {
        console.error(`[${connectionId}] 未找到ID为${data.roleId}的角色`);
        ws.send(JSON.stringify({ 
          type: "error", 
          msg: "未找到该角色" 
        }));
      }
    } else if (data && data.type === "pause") {
      // 新增：处理暂停请求
      isPlaying = false;
      console.log(`[${connectionId}] 暂停播放音频`);
      ws.send(JSON.stringify({ type: "pause-ack" }));
    } else if (data && data.type === "resume") {
      // 新增：处理恢复请求
      if (pendingAudio) {
        isPlaying = true;
        console.log(`[${connectionId}] 恢复播放音频`);
        ws.send(JSON.stringify({ 
          type: "reply-audio", 
          audio: pendingAudio, 
          isPaused: false 
        }));
        pendingAudio = null;
      }
      ws.send(JSON.stringify({ type: "resume-ack" }));
    } else if (data && data.type === "text") {
      // 处理纯文本消息
      console.log(`[${connectionId}] 收到纯文本消息: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
      const userText = data.text;
      ws.send(JSON.stringify({ 
        type: "user-text", 
        text: userText 
      }));

      // 暂停当前播放（如果有的话）
      if (isPlaying) {
        isPlaying = false;
        pendingAudio = null;
      }

      // 检查是否已选择角色
      if (!role) {
        console.error(`[${connectionId}] 未选择角色，无法处理消息`);
        ws.send(JSON.stringify({ 
          type: "error", 
          msg: "请先选择一个角色" 
        }));
        return;
      }

      // 判断是否使用英文语音包 (en_US开头的模型)
      const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
      const replyText = await chatWithOllama(role.system_prompt, userText, isEnglishVoice);
      console.log(`[${connectionId}] AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

      ws.send(JSON.stringify({ 
        type: "reply-text", 
        text: replyText 
      }));

      // 传递当前角色的语音模型
      const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
      playAudio(audioBuf.toString("base64"));
    } else if (data && data.type === "audio-chunk") {
      // 新增：检查用户是否已选择角色，如果未选择，则提醒用户
      if (!role) {
        console.warn(`[${connectionId}] 警告：未选择角色就开始发送音频数据`);
      }
      chunks.push(Buffer.from(data.chunk, "base64"));
    } else if (data && data.type === "stop") {
      const full = Buffer.concat(chunks);
      chunks = [];

      // 使用监控版本的transcribeBuffer函数
      const userText = await logger.monitorTranscribeBuffer(transcribeBuffer)(full);
      console.log(`[${connectionId}] 语音转文字结果: ${userText}`);

      // 再次检查转文字结果，确保不包含文件路径信息
      if (userText.includes('tmp_recv') || userText.includes('path') || userText.includes('D:\\')) {
        console.error(`[${connectionId}] ⚠️ 严重警告: 语音转文字结果包含文件路径信息: "${userText}"`);
        // 可选：发送一个安全的默认文本，而不是可能包含敏感信息的文本
        // ws.send(JSON.stringify({ type:"user-text", text:"[语音识别出现问题，请重试]" }));
      }

      ws.send(JSON.stringify({ 
        type: "user-text", 
        text: userText 
      }));

      // 暂停当前播放（如果有的话）
      if (isPlaying) {
        isPlaying = false;
        pendingAudio = null;
      }

      // 检查是否已选择角色
      if (!role) {
        console.error(`[${connectionId}] 未选择角色，无法处理消息。请先在界面上选择一个角色。`);
        ws.send(JSON.stringify({ 
          type: "error", 
          msg: "请先选择一个角色" 
        }));
        return;
      }

      // 判断是否使用英文语音包 (en_US开头的模型)
      const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
      const replyText = await chatWithOllama(role.system_prompt, userText, isEnglishVoice);
      console.log(`[${connectionId}] AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

      ws.send(JSON.stringify({ 
        type: "reply-text", 
        text: replyText 
      }));

      // 传递当前角色的语音模型
      const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
      playAudio(audioBuf.toString("base64"));
    } else if (data && data.type === "regenerate") {
      // 新增：处理重新生成AI回复的请求
      console.log(`[${connectionId}] 收到重新生成AI回复请求: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
      const userText = data.text;

      // 暂停当前播放（如果有的话）
      if (isPlaying) {
        isPlaying = false;
        pendingAudio = null;
      }

      // 检查是否已选择角色
      if (!role) {
        console.error(`[${connectionId}] 未选择角色，无法处理重新生成请求`);
        ws.send(JSON.stringify({ 
          type: "error", 
          msg: "请先选择一个角色" 
        }));
        return;
      }

      // 判断是否使用英文语音包 (en_US开头的模型)
      const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
      const replyText = await chatWithOllama(role.system_prompt, userText, isEnglishVoice);
      console.log(`[${connectionId}] 重新生成AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

      ws.send(JSON.stringify({ 
        type: "reply-text", 
        text: replyText 
      }));

      // 传递当前角色的语音模型
      const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
      playAudio(audioBuf.toString("base64"));
    }
  });

  ws.on("close", () => console.log(`client disconnected [ID: ${connectionId}]`));
});