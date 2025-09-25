import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("roles.db");
const upload = multer({ dest: "uploads/" });
const __dirname = path.resolve();

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

  const data = await resp.json();
  if (data?.message?.content) return data.message.content;
  if (data?.response) return data.response;
  if (data?.content) return data.content;
  return JSON.stringify(data);
}

// ====== Whisper STT (call whisper.cpp executable) ======
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

// ====== Piper TTS (call python tts.py) ======
function synthesizeSpeech(text, outputPath, voiceModel = null) {
  return new Promise((resolve, reject) => {
    const tmpIn = path.join(__dirname, `tmp_tts_input_${Date.now()}.txt`);
    fs.writeFileSync(tmpIn, text, "utf-8");

    const args = ["tts.py", tmpIn, outputPath];
    if (voiceModel) {
      args.push(voiceModel);
      console.log(`[TTS] 使用语音模型: ${voiceModel}`);
    }

    const py = spawn("python", args);

    py.stdout.on("data", (data) => console.log("Piper:", data.toString()));
    py.stderr.on("data", (data) => console.error("Piper err:", data.toString()));

    py.on("close", (code) => {
      try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch(e){}
      if (code === 0) resolve(outputPath);
      else reject(new Error(`piper exited ${code}`));
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
    const { roleId, userMessage } = req.body;
    console.log(`[API调用] 收到chat请求，角色ID: ${roleId}`);
    
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!role) {
      console.log(`[API调用] 未找到角色ID: ${roleId}`);
      return res.status(400).json({ error: "role not found" });
    }
    
    console.log(`[API调用] 使用角色: ${role.name} (ID: ${roleId})，语音模型: ${role.voice_model}`);
    
    const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
    const reply = await chatWithOllama(role.system_prompt, userMessage, isEnglishVoice);

    const audioFile = path.join(__dirname, `reply_${Date.now()}.wav`);
    await synthesizeSpeech(reply, audioFile, role.voice_model);

    return res.json({ replyText: reply, audioUrl: `http://localhost:3000/${path.basename(audioFile)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// upload audio -> transcribe -> reply -> tts
app.post("/api/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    const { roleId } = req.body;
    console.log(`[API调用] 收到voice-chat请求，角色ID: ${roleId}`);
    
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!role) {
      console.log(`[API调用] 未找到角色ID: ${roleId}`);
      return res.status(400).json({ error: "role not found" });
    }
    
    console.log(`[API调用] 使用角色: ${role.name} (ID: ${roleId})，语音模型: ${role.voice_model}`);

    const audioPath = req.file.path;
    const wavPath = audioPath.replace(path.extname(audioPath), ".wav");

    // ffmpeg 转换成 wav (16k 单声道)
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y", "-i", audioPath,
        "-ar", "16000", "-ac", "1", wavPath
      ]);
      ffmpeg.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("ffmpeg 转码失败"));
      });
    });

    const text = await transcribeAudio(wavPath);

    const isEnglishVoice = role.voice_model && role.voice_model.startsWith('en_US');
    const reply = await chatWithOllama(role.system_prompt, text, isEnglishVoice);

    const audioFile = path.join(__dirname, `reply_${Date.now()}.wav`);
    await synthesizeSpeech(reply, audioFile, role.voice_model);

    return res.json({ userText: text, replyText: reply, audioUrl: `http://localhost:3000/${path.basename(audioFile)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// serve static (so reply_xxx.wav is accessible)
app.use(express.static(__dirname));

app.listen(3000, () => console.log("✅ REST API running on http://localhost:3000"));
