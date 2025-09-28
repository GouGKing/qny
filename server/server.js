import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("roles.db");
const upload = multer({ dest: "uploads/" });
const __dirname = path.resolve();

// ====== 定义默认LLM模型 ======
const DEFAULT_LLM = 'deepseek/deepseek-v3.1-terminus';

// ====== 完整的日志记录器实现 ======
const logger = {
  info: (...args) => console.log(`[INFO] ${args.join(' ')}`),
  error: (...args) => console.error(`[ERROR] ${args.join(' ')}`),
  debug: (...args) => console.log(`[DEBUG] ${args.join(' ')}`),
  monitorWebSocketMessages: (ws) => {
    const originalSend = ws.send;
    ws.send = function(message, options, callback) {
      console.log(`[WebSocket] 发送消息: ${message.length > 100 ? message.substring(0, 100) + '...' : message}`);
      return originalSend.call(this, message, options, callback);
    };
  },
  monitorTranscribeBuffer: (transcribeFunc) => {
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

// ====== 全局错误处理，防止服务崩溃 ======
process.on('uncaughtException', (error) => {
  console.error('[FATAL] 未捕获的异常:', error);
  console.error('[FATAL] 堆栈跟踪:', error.stack);
  // 不退出进程，让服务继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] 未处理的Promise拒绝:', reason);
  console.error('[FATAL] Promise:', promise);
  // 不退出进程，让服务继续运行
});

// ====== call Ollama (local) ======
async function chatWithOllama(systemPrompt, userInput, isEnglishVoice = false) {
  let finalSystemPrompt = systemPrompt;
  if (isEnglishVoice) {
    finalSystemPrompt = `${systemPrompt}\n\n重要要求：请一定用英语回答，不要使用任何中文。所有回复内容必须是英文。`;
    console.log("[语言控制] 使用英文语音包，强制要求英文回复");
  }

  const resp = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral",
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: isEnglishVoice ? `Please reply in English only.\n${userInput}` : userInput }
      ]
    }),
  });

  if (!resp.ok) {
    console.error(`Ollama API 错误: ${resp.status} ${resp.statusText}`);
    return "抱歉，我暂时无法回答。";
  }
  
  let data;
  try {
    const responseText = await resp.text();
    console.log(`[Ollama] 原始响应: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);
    
    if (responseText.includes('\n')) {
      const lines = responseText.trim().split('\n');
      let lastValidJson = null;
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            lastValidJson = parsed;
          } catch (e) {
            console.warn(`[Ollama] 跳过无效JSON行: ${line.substring(0, 50)}...`);
          }
        }
      }
      
      if (lastValidJson) {
        data = lastValidJson;
      } else {
        throw new Error("无法解析任何有效的JSON响应");
      }
    } else {
      data = JSON.parse(responseText);
    }
  } catch (err) {
    console.error(`[Ollama] JSON解析错误:`, err);
    return "抱歉，我暂时无法回答。";
  }
  
  console.log(`[Ollama] 解析后的数据:`, JSON.stringify(data).substring(0, 100) + (JSON.stringify(data).length > 100 ? '...' : ''));
  
  if (data?.message?.content) return data.message.content;
  if (data?.response) return data.response;
  if (data?.content) return data.content;
  
  console.warn("未识别的Ollama响应格式");
  return JSON.stringify(data);
}

// ====== call DeepSeek (remote) ======
async function chatWithDeepSeek(systemPrompt, userInput, isEnglishVoice = false) {
  try {
    console.log(`向DeepSeek发送请求 - 用户输入: ${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}`);
    
    let finalSystemPrompt = systemPrompt;
    if (isEnglishVoice) {
      finalSystemPrompt = `${systemPrompt}\n\n重要要求：请一定用英语回答，不要使用任何中文。所有回复内容必须是英文。`;
      console.log("[语言控制] 使用英文语音包，强制要求英文回复");
    }
    
    const resp = await fetch("https://openai.qiniu.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "sk-7307b25790c00ba2e1717dfabf4f2caa7c8fe4e230df221b68c3bd8857f95be2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        stream: false,
        model: "deepseek/deepseek-v3.1-terminus",
        messages: [
          { role: "system", content: finalSystemPrompt },
          { role: "user", content: userInput }
        ]
      }),
    });
    
    if (!resp.ok) {
      console.error(`DeepSeek API 错误: ${resp.status} ${resp.statusText}`);
      return "抱歉，我暂时无法回答。";
    }
    
    let data;
    try {
      const responseText = await resp.text();
      console.log(`[DeepSeek] 原始响应: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);
      data = JSON.parse(responseText);
    } catch (err) {
      console.error(`[DeepSeek] JSON解析错误:`, err);
      return "抱歉，我暂时无法回答。";
    }
    
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data?.response) return data.response;
    if (data?.content) return data.content;
    
    console.warn("未识别的DeepSeek响应格式");
    return JSON.stringify(data);
  } catch (err) {
    console.error("DeepSeek调用错误:", err);
    return "抱歉，我暂时无法回答。";
  }
}

// ====== 统一的LLM调用入口 ======
async function chatWithLLM(systemPrompt, userInput, llm = 'deepseek', isEnglishVoice = false) {
  if (llm === 'mistral') {
    return await chatWithOllama(systemPrompt, userInput, isEnglishVoice);
  } else {
    return await chatWithDeepSeek(systemPrompt, userInput, isEnglishVoice);
  }
}

// ====== 语音转文字 - 修复版（使用 ffmpeg stdin 管道，避免临时原始文件竞争） ======
function transcribeBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    // 输出 wav 仍然使用唯一文件，避免并发冲突
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const tmpWav = path.join(__dirname, `tmp_recv_${timestamp}_${randomId}.wav`);
    const ffmpegTimeoutMs = options.ffmpegTimeoutMs || 20_000; // 20s 超时可调整

    console.log(`[STT] transcribeBuffer: 准备将 buffer 通过 ffmpeg 转为 wav -> ${tmpWav}`);

    let ffmpegExited = false;
    let ffmpegStderr = "";

    // 启动 ffmpeg，输入从 stdin(pipe:0)
    const ffmpegArgs = [
      "-y",
      "-f", "webm",        // 输入容器格式
      "-c:a", "opus",      // 输入音频编码
      "-i", "pipe:0",      // 从 stdin 读取
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      tmpWav
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    // 捕获 stderr 便于问题定位
    ffmpeg.stderr.on("data", (d) => {
      const s = d.toString();
      ffmpegStderr += s;
      console.log("[FFmpeg]", s);
    });

    ffmpeg.on("error", (err) => {
      console.error("[STT] FFmpeg spawn 错误:", err);
    });

    const ffmpegTimer = setTimeout(() => {
      if (!ffmpegExited) {
        console.warn("[STT] FFmpeg 超时，尝试杀死进程");
        try { ffmpeg.kill("SIGKILL"); } catch (e) { /* ignore */ }
      }
    }, ffmpegTimeoutMs);

    ffmpeg.on("close", (code, signal) => {
      ffmpegExited = true;
      clearTimeout(ffmpegTimer);

      if (code !== 0) {
        console.error(`[STT] ffmpeg 转码失败，退出码: ${code}, 信号: ${signal}`);
        console.error(`[STT] ffmpeg stderr: ${ffmpegStderr}`);
        // 尝试删除可能的残留文件
        try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch (e) { console.warn("[STT] 删除 tmpWav 失败:", e.message); }
        return reject(new Error(`ffmpeg 转码失败: ${ffmpegStderr}`));
      }

      // 确认 wav 文件存在
      if (!fs.existsSync(tmpWav)) {
        console.error("[STT] ffmpeg 完成但未生成 wav 文件");
        return reject(new Error("ffmpeg 未生成输出文件"));
      }

      // 运行 whisper-cli，读取 wav 转文本
      const whisperExec = path.join(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
      const modelPath   = path.join(__dirname, "../whisper.cpp/build/bin/Release/ggml-medium.bin");

      console.log(`[STT] 调用 Whisper: ${whisperExec} -m ${modelPath} -otxt -l auto -np ${tmpWav}`);

      const whisper = spawn(whisperExec, [
        "-m", modelPath,
        "-otxt",
        "-l", "auto",
        "-np",
        tmpWav
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let whisperStdout = "";
      let whisperStderr = "";
      let whisperExited = false;

      whisper.stdout.on("data", (d) => {
        const s = d.toString();
        whisperStdout += s;
        console.log("[Whisper]", s);
      });

      whisper.stderr.on("data", (d) => {
        const s = d.toString();
        whisperStderr += s;
        console.error("[Whisper ERR]", s);
      });

      const whisperTimer = setTimeout(() => {
        if (!whisperExited) {
          console.warn("[STT] Whisper 超时，尝试杀死进程");
          try { whisper.kill("SIGKILL"); } catch (e) { /* ignore */ }
        }
      }, 30_000);

      whisper.on("close", (whisperCode, whisperSignal) => {
        whisperExited = true;
        clearTimeout(whisperTimer);

        const txtFile = tmpWav + ".txt";
        let textResult = "";

        if (fs.existsSync(txtFile)) {
          try {
            textResult = fs.readFileSync(txtFile, "utf-8").trim();
            // 删除 txt 文件
            try { fs.unlinkSync(txtFile); } catch (e) { console.warn("[STT] 删除 txt 文件失败:", e.message); }
          } catch (readErr) {
            console.error("[STT] 读取 txt 文件失败:", readErr);
          }
        } else {
          // 如果没有 txt 文件但 whisperCode 为 0，尝试根据 stdout 内容获取
          if (whisperCode === 0 && whisperStdout) {
            textResult = whisperStdout.trim();
          }
        }

        // 清理 wav
        try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch (e) { console.warn("[STT] 删除 wav 文件失败:", e.message); }

        if (!textResult) {
          console.warn(`[STT] 未能从 Whisper 获取文本，whisperCode=${whisperCode}, stderr=${whisperStderr}`);
          // 返回空字符串而不是 reject，让上层决定是否重试
          return resolve("");
        }

        console.log(`[STT] 转文字成功: ${textResult}`);
        resolve(textResult);
      });

      whisper.on("error", (err) => {
        clearTimeout(whisperTimer);
        console.error("[STT] Whisper spawn 错误:", err);
        try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch (e) { console.warn("[STT] 删除 tmpWav 失败:", e.message); }
        reject(err);
      });
    });

    // 将 buffer 写入 ffmpeg stdin，然后关闭 stdin
    try {
      ffmpeg.stdin.write(buffer, (err) => {
        if (err) {
          console.error("[STT] 写入 ffmpeg stdin 失败:", err);
          try { ffmpeg.kill("SIGKILL"); } catch (e) {}
          return reject(err);
        }
        ffmpeg.stdin.end();
      });
    } catch (err) {
      clearTimeout(ffmpegTimer);
      console.error("[STT] 向 ffmpeg 写入 buffer 时异常:", err);
      try { ffmpeg.kill("SIGKILL"); } catch (e) {}
      reject(err);
    }
  });
}

// ====== 调用 Piper TTS (使用修复后的tts.py)，改为使用唯一临时文本文件名以避免冲突 ======
function synthesizeSpeech(text, voiceModel = null) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(__dirname, `reply_${Date.now()}_${Math.random().toString(36).slice(2,8)}.wav`);
    console.log(`[TTS] 正在调用TTS生成音频: "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`);
    console.log(`[TTS] 当前语音模型: ${voiceModel || '未指定'}`);

    const textFile = path.join(__dirname, `tts_text_${Date.now()}_${Math.random().toString(36).slice(2,8)}.txt`);
    fs.writeFileSync(textFile, text, 'utf-8');

    const args = ["tts.py", textFile, outFile];
    if (voiceModel) {
      args.push(voiceModel);
      console.log(`[TTS] 正在使用指定的语音模型: ${voiceModel}`);
    } else {
      console.log(`[TTS] 未指定语音模型，将使用tts.py的默认逻辑`);
    }

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

        if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
          generateBackupBeep(outFile);
        }
      }

      try {
        const audio = fs.readFileSync(outFile);
        console.log(`[Success] TTS音频生成成功，大小: ${audio.length} 字节`);
        // 不删除 outFile，让静态服务可以直接访问（和你原来逻辑一致）
        resolve(audio);
      } catch (err) {
        console.error("[Error] 无法读取音频文件:", err);
        reject(err);
      }
    });

    py.on("error", (err) => {
      console.error("[Error] 启动TTS进程失败:", err);
      try { if (fs.existsSync(textFile)) fs.unlinkSync(textFile); } catch (e) {}
      reject(err);
    });
  });
}

// ====== 生成后备提示音（当TTS失败时使用） ======
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
  const wavFile = Buffer.concat([header, buffer]);
  fs.writeFileSync(filePath, wavFile);
  console.log("[Warning] 生成了后备提示音");
}

// ====== Whisper STT (call whisper.cpp executable) - 保留用于文件路径版本（如果你有需要） ======
function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const whisperExec = path.join(
      __dirname,
      "../whisper.cpp/build/bin/Release/whisper-cli.exe"
    );

    const modelPath = path.join(
      __dirname,
      "../whisper.cpp/models/ggml-medium.bin"
    );

    const whisper = spawn(whisperExec, [
      "-m", modelPath,
      "-f", filePath,
      "-otxt",
      "-l", "auto"   // 自动检测语言（中英混合）
    ]);

    whisper.on("close", () => {
      const txtFile = filePath.replace(".wav", ".txt");
      let result = "";
      try {
        if (fs.existsSync(txtFile)) result = fs.readFileSync(txtFile, "utf-8").trim();
      } catch (e) { console.error("read txt error", e); }
      resolve(result);
    });

    whisper.on("error", (err) => {
      console.error("whisper spawn error:", err);
      reject(err);
    });
  });
}

// ====== REST API ======

// get roles
app.get("/api/roles", (req, res) => {
  const roles = db.prepare("SELECT * FROM roles").all();
  res.json(roles);
});

// text chat -> generate reply and tts
app.post("/api/chat", async (req, res) => {
  try {
    const { roleId, userMessage, llm } = req.body;
    console.log(`[API调用] 收到chat请求，角色ID: ${roleId}`);
    
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!role) {
      console.log(`[API调用] 未找到角色ID: ${roleId}`);
      return res.status(400).json({ error: "role not found" });
    }
    
    console.log(`[API调用] 使用角色: ${role.name} (ID: ${roleId})，语音模型: ${role.voice_model}`);
    
    const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
    const reply = await chatWithLLM(role.system_prompt, userMessage, llm || DEFAULT_LLM, isEnglishVoice);

    const audioFile = path.join(__dirname, `reply_${Date.now()}.wav`);
    const audioBuf = await synthesizeSpeech(reply, role.voice_model);
    fs.writeFileSync(audioFile, audioBuf);

    return res.json({ replyText: reply, audioUrl: `http://localhost:3000/${path.basename(audioFile)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// upload audio -> transcribe -> reply -> tts
app.post("/api/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    const { roleId, llm } = req.body;
    console.log(`[API调用] 收到voice-chat请求，角色ID: ${roleId}`);
    
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!role) {
      console.log(`[API调用] 未找到角色ID: ${roleId}`);
      return res.status(400).json({ error: "role not found" });
    }
    
    console.log(`[API调用] 使用角色: ${role.name} (ID: ${roleId})，语音模型: ${role.voice_model}`);

    const audioPath = req.file.path;
    const wavPath = audioPath.replace(path.extname(audioPath), ".wav");

    // ffmpeg 转换成 wav (16k 单声道) - 使用文件方式保留为后备（但一般建议使用 transcribeBuffer）
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y", "-i", audioPath,
        "-ar", "16000", "-ac", "1", wavPath
      ]);
      ffmpeg.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("ffmpeg 转码失败"));
      });
      ffmpeg.on("error", (err) => reject(err));
    });

    const text = await transcribeAudio(wavPath);

    const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
    const reply = await chatWithLLM(role.system_prompt, text, llm || DEFAULT_LLM, isEnglishVoice);

    const audioFile = path.join(__dirname, `reply_${Date.now()}.wav`);
    const audioBuf = await synthesizeSpeech(reply, role.voice_model);
    fs.writeFileSync(audioFile, audioBuf);

    return res.json({ userText: text, replyText: reply, audioUrl: `http://localhost:3000/${path.basename(audioFile)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// serve static (so reply_xxx.wav is accessible)
app.use(express.static(__dirname));

// serve frontend static files
const frontendDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(frontendDistPath)) {
  console.log(`📁 前端构建文件目录已找到: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    const filePath = path.join(frontendDistPath, req.path);
    if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  console.warn(`⚠️ 未找到前端构建文件目录: ${frontendDistPath}`);
  console.warn('⚠️ 请先运行前端构建命令: cd ../client && npm run build');
}

// ====== 启动服务器 ======
const server = app.listen(3000, () => {
  console.log("✅ REST API running on http://localhost:3000");
  console.log("✅ WebSocket Server running on ws://localhost:3000");
});

// ====== WebSocket 服务器 ======
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const connectionId = Math.random().toString(36).substring(2, 10);
  console.log(`client connected [ID: ${connectionId}]`);
  let role = db.prepare("SELECT * FROM roles LIMIT 1").get();
  if (role) {
    console.log(`[${connectionId}] 已自动选择默认角色: ${role.name} [voice_model: ${role.voice_model}]`);
  } else {
    console.log(`[${connectionId}] 未找到默认角色，等待用户选择`);
    role = null;
  }
  let chunks = [];
  let isPlaying = false;
  let pendingAudio = null;

  logger.monitorWebSocketMessages(ws);

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

    const safeExecute = async (operation) => {
      try {
        await operation();
      } catch (error) {
        console.error(`[${connectionId}] 操作执行失败:`, error);
        try {
          ws.send(JSON.stringify({ 
            type: "error", 
            msg: `处理失败: ${error.message}` 
          }));
        } catch (sendError) {
          console.error(`[${connectionId}] 发送错误消息失败:`, sendError);
        }
        chunks = [];
        isPlaying = false;
        pendingAudio = null;
      }
    };

    if (data && data.type === "config") {
      console.log(`[${connectionId}] 收到角色配置请求: roleId=${data.roleId}`);
      role = db.prepare("SELECT * FROM roles WHERE id = ?").get(data.roleId);
      if (role) {
        console.log(`[${connectionId}] 角色切换为: ${role.name} [voice_model: ${role.voice_model}]`);
        ws.send(JSON.stringify({ type: "info", msg: `角色切换：${role.name}` }));
      } else {
        console.error(`[${connectionId}] 未找到ID为${data.roleId}的角色`);
        ws.send(JSON.stringify({ type: "error", msg: "未找到该角色" }));
      }
    } else if (data && data.type === "pause") {
      isPlaying = false;
      console.log(`[${connectionId}] 暂停播放音频`);
      ws.send(JSON.stringify({ type: "pause-ack" }));
    } else if (data && data.type === "resume") {
      if (pendingAudio) {
        isPlaying = true;
        console.log(`[${connectionId}] 恢复播放音频`);
        ws.send(JSON.stringify({ type: "reply-audio", audio: pendingAudio, isPaused: false }));
        pendingAudio = null;
      }
      ws.send(JSON.stringify({ type: "resume-ack" }));
    } else if (data && data.type === "interview-start") {
      await safeExecute(async () => {
        console.log(`[${connectionId}] 收到面试开始消息: ${data.question}`);
        if (!role) {
          console.error(`[${connectionId}] 未选择角色，无法开始面试`);
          ws.send(JSON.stringify({ type: "error", msg: "请先选择一个角色" }));
          return;
        }

        const interviewSystemPrompt = `你是一位专业的面试官，正在对候选人进行面试。请以专业、友好的态度进行面试。

当前面试问题：${data.question}

请：
1. 首先向候选人问好，并介绍自己
2. 提出当前问题
3. 鼓励候选人详细回答
4. 保持专业和友好的语调

角色背景：${role.system_prompt}`;

        const llm = data.llm || DEFAULT_LLM;
        const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
        const replyText = await chatWithLLM(interviewSystemPrompt, `开始面试，第一个问题是：${data.question}`, llm, isEnglishVoice);
        
        console.log(`[${connectionId}] 面试开始回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

        ws.send(JSON.stringify({ type: "reply-text", text: replyText }));
        const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
        playAudio(audioBuf.toString("base64"));
      });
    } else if (data && data.type === "interview-question") {
      await safeExecute(async () => {
        console.log(`[${connectionId}] 收到面试问题消息: ${data.question}`);
        if (!role) {
          console.error(`[${connectionId}] 未选择角色，无法处理面试问题`);
          ws.send(JSON.stringify({ type: "error", msg: "请先选择一个角色" }));
          return;
        }

        const interviewSystemPrompt = `你是一位专业的面试官，正在对候选人进行面试。请以专业、友好的态度进行面试。

当前面试问题：${data.question}
问题序号：${data.questionIndex + 1}

请：
1. 自然地过渡到下一个问题
2. 提出当前问题
3. 鼓励候选人详细回答
4. 保持专业和友好的语调

角色背景：${role.system_prompt}`;

        const llm = data.llm || DEFAULT_LLM;
        const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
        const replyText = await chatWithLLM(interviewSystemPrompt, `继续面试，下一个问题是：${data.question}`, llm, isEnglishVoice);
        
        console.log(`[${connectionId}] 面试问题回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

        ws.send(JSON.stringify({ type: "reply-text", text: replyText }));
        const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
        playAudio(audioBuf.toString("base64"));
      });
    } else if (data && data.type === "text") {
      await safeExecute(async () => {
        console.log(`[${connectionId}] 收到纯文本消息: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
        const userText = data.text;
        const llm = data.llm || DEFAULT_LLM;
        console.log(`[${connectionId}] 选择的LLM模型: ${llm}`);
        
        ws.send(JSON.stringify({ type: "user-text", text: userText }));

        if (isPlaying) {
          isPlaying = false;
          pendingAudio = null;
        }

        if (!role) {
          console.error(`[${connectionId}] 未选择角色，无法处理消息`);
          ws.send(JSON.stringify({ type: "error", msg: "请先选择一个角色" }));
          return;
        }

        const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
        const replyText = await chatWithLLM(role.system_prompt, userText, llm, isEnglishVoice);
        console.log(`[${connectionId}] AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

        ws.send(JSON.stringify({ type: "reply-text", text: replyText }));
        const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
        playAudio(audioBuf.toString("base64"));
      });
    } else if (data && data.type === "audio-chunk") {
      if (!role) {
        console.warn(`[${connectionId}] 警告：未选择角色就开始发送音频数据`);
      }
      chunks.push(Buffer.from(data.chunk, "base64"));
    } else if (data && data.type === "stop") {
      await safeExecute(async () => {
        const full = Buffer.concat(chunks);
        chunks = [];

        console.log(`[${connectionId}] 开始处理语音转文字，音频大小: ${full.length} 字节`);

        // 使用改进版 transcribeBuffer（直接管道到 ffmpeg）
        const userText = await logger.monitorTranscribeBuffer(transcribeBuffer)(full);
        console.log(`[${connectionId}] 语音转文字结果: ${userText}`);
        const llm = data.llm || DEFAULT_LLM;
        console.log(`[${connectionId}] 选择的LLM模型: ${llm}`);

        if (userText.includes('tmp_recv') || userText.includes('path') || userText.includes('D:\\')) {
          console.error(`[${connectionId}] ⚠️ 严重警告: 语音转文字结果包含文件路径信息: "${userText}"`);
          ws.send(JSON.stringify({ type:"user-text", text:"[语音识别出现问题，请重试]" }));
          return;
        }

        ws.send(JSON.stringify({ type: "user-text", text: userText }));

        if (isPlaying) {
          isPlaying = false;
          pendingAudio = null;
        }

        if (!role) {
          console.error(`[${connectionId}] 未选择角色，无法处理消息。请先在界面上选择一个角色。`);
          ws.send(JSON.stringify({ type: "error", msg: "请先选择一个角色" }));
          return;
        }

        const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
        const replyText = await chatWithLLM(role.system_prompt, userText, llm, isEnglishVoice);
        console.log(`[${connectionId}] AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

        ws.send(JSON.stringify({ type: "reply-text", text: replyText }));
        const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
        playAudio(audioBuf.toString("base64"));
      });
    } else if (data && data.type === "regenerate") {
      await safeExecute(async () => {
        console.log(`[${connectionId}] 收到重新生成AI回复请求: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
        const userText = data.text;
        const llm = data.llm || DEFAULT_LLM;
        console.log(`[${connectionId}] 选择的LLM模型: ${llm}`);

        if (isPlaying) {
          isPlaying = false;
          pendingAudio = null;
        }

        if (!role) {
          console.error(`[${connectionId}] 未选择角色，无法处理重新生成请求`);
          ws.send(JSON.stringify({ type: "error", msg: "请先选择一个角色" }));
          return;
        }

        const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
        const replyText = await chatWithLLM(role.system_prompt, userText, llm, isEnglishVoice);
        console.log(`[${connectionId}] 重新生成AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);

        ws.send(JSON.stringify({ type: "reply-text", text: replyText }));
        const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
        playAudio(audioBuf.toString("base64"));
      });
    }
  });

  ws.on("close", () => console.log(`client disconnected [ID: ${connectionId}]`));
});
