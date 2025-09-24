import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import fetch from "node-fetch";
import { setupLogger } from './detailed-logger.js';

// 设置详细日志记录器
const logger = setupLogger();

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
      headers: { "Content-Type": "application/json" },
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
function transcribeBuffer(buffer) {
  return new Promise((resolve, reject) => {
    try {
      const tmpFile = path.join(__dirname, "tmp_recv.wav");
      const processedFile = path.join(__dirname, "processed_recv.wav"); // 额外保存一份处理后的文件用于调试
      
      // 重要修复：创建一个全新的、格式正确的WAV文件
      // 完全按照调试脚本中验证过的有效方法
      const sampleRate = 44100; // 标准采样率
      const numChannels = 1; // 单声道
      const bitDepth = 16; // 16位PCM
      
      // 提取音频数据 - 确保使用正确的数据部分
      let audioData = buffer;
      // 如果原始数据可能包含文件头，尝试提取纯数据部分
      if (audioData.length > 44) {
        // 检查前4字节是否为"RIFF"标识
        const hasRiffHeader = audioData.toString('ascii', 0, 4) === 'RIFF';
        if (hasRiffHeader) {
          console.log('[STT] 检测到原始数据包含RIFF头，尝试提取纯音频数据');
          // 尝试提取数据部分（跳过文件头）
          const dataSize = audioData.readUInt32LE(40);
          if (audioData.length >= 44 + dataSize) {
            audioData = audioData.subarray(44, 44 + dataSize);
            console.log(`[STT] 已提取纯音频数据，大小: ${audioData.length} 字节`);
          }
        }
      }
      
      console.log(`[STT] 处理音频数据，大小: ${audioData.length} 字节`);
      
      // 创建标准的WAV文件头
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + audioData.length, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20); // PCM格式
      header.writeUInt16LE(numChannels, 22); // 单声道
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28); // 字节率
      header.writeUInt16LE(2, 32); // 块对齐
      header.writeUInt16LE(16, 34); // 采样位数
      header.write('data', 36);
      header.writeUInt32LE(audioData.length, 40);
      
      // 组合头部和数据，创建正确格式的WAV文件
      const wavFile = Buffer.concat([header, audioData]);
      fs.writeFileSync(tmpFile, wavFile);
      fs.writeFileSync(processedFile, wavFile); // 保存一份用于调试
      
      console.log(`[STT] 已创建标准WAV文件: ${tmpFile}, 大小: ${wavFile.length} 字节`);
      console.log(`[STT] 已保存调试文件: ${processedFile}`);

      const whisperExec = path.join(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
      const modelPath = path.join(__dirname, "../whisper.cpp/build/bin/Release/ggml-base.bin");
      
      // 使用验证过的正确参数调用whisper-cli
      console.log(`[STT] 开始中文语音转文字处理...`);
      console.log(`[STT] 命令: ${whisperExec} -m ${modelPath} -otxt -l zh -np ${tmpFile}`);
      
      // 使用监控版本的spawn调用
      const whisper = logger.monitorWhisperCall(spawn, whisperExec, modelPath, tmpFile);
      
      // 捕获输出以进行调试
      whisper.stdout.on('data', (data) => {
        console.log(`[STT] whisper输出: ${data}`);
      });
      
      whisper.stderr.on('data', (data) => {
        console.error(`[STT] whisper错误: ${data}`);
      });

      whisper.on("close", () => {
            // 修复文件路径问题：正确的输出文件名应该是 tmp_recv.wav.txt
            const txtFile = tmpFile + ".txt";
            let text = "";
            if (fs.existsSync(txtFile)) {
              text = fs.readFileSync(txtFile, "utf-8").trim();
              console.log(`[STT] 转文字成功: ${text}`);
            } else {
              console.warn(`[STT] 未生成文本文件: ${txtFile}`);
              // 检查另一种可能的文件路径格式
              const altTxtFile = tmpFile.replace(".wav", ".txt");
              if (fs.existsSync(altTxtFile)) {
                text = fs.readFileSync(altTxtFile, "utf-8").trim();
                console.log(`[STT] 找到备选文本文件: ${altTxtFile}, 内容: ${text}`);
              }
            }
            
            // 额外检查：确保返回的文本不是文件路径
            if (text.includes('tmp_recv') || text.includes('path') || text.includes('D:\\')) {
              console.error(`⚠️  警告: 返回的文本包含文件路径信息: "${text}"`);
            }
            
            resolve(text);
          });

      whisper.on("error", (err) => {
        console.error("[STT] whisper进程错误:", err);
        reject(err);
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
    const args = ["tts.py", text, outFile];
    if (voiceModel) {
      args.push(voiceModel);
      console.log(`[TTS] 正在使用指定的语音模型: ${voiceModel}`);
    } else {
      console.log(`[TTS] 未指定语音模型，将使用tts.py的默认逻辑`);
    }

    // 调用tts.py，传递所有必要参数
    const py = spawn("python", args);
    
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
  let role = null; // 初始化为null，等待客户端明确选择角色
  let chunks = [];
  let isPlaying = false; // 新增：跟踪当前是否正在播放语音
  let pendingAudio = null; // 新增：存储暂停时的待播放音频

  // 使用监控版本的WebSocket消息处理
  logger.monitorWebSocketMessages(ws);

  // 新增：播放音频的函数，支持暂停/恢复
  function playAudio(audioData) {
    if (!isPlaying) {
      isPlaying = true;
      console.log("开始播放音频");
      ws.send(JSON.stringify({ type:"reply-audio", audio: audioData, isPaused: false }));
    }
  }

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
      if (role) {
        console.log(`角色切换为: ${role.name}`);
        ws.send(JSON.stringify({ type:"info", msg:`角色切换：${role.name}` }));
      } else {
        console.error(`未找到ID为${data.roleId}的角色`);
        ws.send(JSON.stringify({ type:"error", msg:`未找到该角色` }));
      }
    } else if (data && data.type === "pause") {
      // 新增：处理暂停请求
      isPlaying = false;
      console.log("暂停播放音频");
      ws.send(JSON.stringify({ type:"pause-ack" }));
    } else if (data && data.type === "resume") {
      // 新增：处理恢复请求
      if (pendingAudio) {
        isPlaying = true;
        console.log("恢复播放音频");
        ws.send(JSON.stringify({ type:"reply-audio", audio: pendingAudio, isPaused: false }));
        pendingAudio = null;
      }
      ws.send(JSON.stringify({ type:"resume-ack" }));
    } else if (data && data.type === "text") {
      // 处理纯文本消息
      console.log(`收到纯文本消息: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}`);
      const userText = data.text;
      ws.send(JSON.stringify({ type:"user-text", text:userText }));

      // 暂停当前播放（如果有的话）
      if (isPlaying) {
        isPlaying = false;
        pendingAudio = null;
      }

      // 检查是否已选择角色
      if (!role) {
        console.error("未选择角色，无法处理消息");
        ws.send(JSON.stringify({ type:"error", msg:"请先选择一个角色" }));
        return;
      }
      
      // 检查是否已选择角色
      if (!role) {
        console.error("未选择角色，无法处理语音消息");
        ws.send(JSON.stringify({ type:"error", msg:"请先选择一个角色" }));
        return;
      }
      
      // 判断是否使用英文语音包 (en_US开头的模型)
      const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
      
      const replyText = await chatWithOllama(role.system_prompt, userText, isEnglishVoice);
      console.log(`AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);
      ws.send(JSON.stringify({ type:"reply-text", text:replyText }));

      // 传递当前角色的语音模型
      const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
      playAudio(audioBuf.toString("base64"));
    } else if (data && data.type === "audio-chunk") {
      chunks.push(Buffer.from(data.chunk, "base64"));
    } else if (data && data.type === "stop") {
      const full = Buffer.concat(chunks);
      chunks = [];

      // 使用监控版本的transcribeBuffer函数
      const userText = await logger.monitorTranscribeBuffer(transcribeBuffer)(full);
      console.log(`语音转文字结果: ${userText}`);
      
      // 再次检查转文字结果，确保不包含文件路径信息
      if (userText.includes('tmp_recv') || userText.includes('path') || userText.includes('D:\\')) {
        console.error(`⚠️  严重警告: 语音转文字结果包含文件路径信息: "${userText}"`);
        // 可选：发送一个安全的默认文本，而不是可能包含敏感信息的文本
        // ws.send(JSON.stringify({ type:"user-text", text:"[语音识别出现问题，请重试]" }));
      }
      
      ws.send(JSON.stringify({ type:"user-text", text:userText }));

      // 暂停当前播放（如果有的话）
      if (isPlaying) {
        isPlaying = false;
        pendingAudio = null;
      }

      // 判断是否使用英文语音包 (en_US开头的模型)
      const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
      
      const replyText = await chatWithOllama(role.system_prompt, userText, isEnglishVoice);
      console.log(`AI回复: ${replyText.substring(0, 30)}${replyText.length > 30 ? '...' : ''}`);
      ws.send(JSON.stringify({ type:"reply-text", text:replyText }));

      // 传递当前角色的语音模型
      const audioBuf = await synthesizeSpeech(replyText, role.voice_model);
      playAudio(audioBuf.toString("base64"));
    }
  });

  ws.on("close", () => console.log("client disconnected"));
});
