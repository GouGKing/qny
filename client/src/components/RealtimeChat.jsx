import { useEffect, useRef, useState } from "react";
import './RealtimeChat.css';

export default function RealtimeChat({ onExit, roleAvatars, selectedRole }) {
  const [socket, setSocket] = useState(null);
  const [chat, setChat] = useState([]);
  const [recording, setRecording] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerphone, setIsSpeakerphone] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3001");
    ws.onopen = () => console.log("[Realtime] ws open");
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "partial-stt") {
          // 实时识别结果
          setChat(prev => {
            const arr = [...prev];
            if (arr.length === 0 || arr[arr.length - 1].role !== "AI正在思考...") {
              arr.push({ user: data.text, role: "AI正在思考..." });
            } else {
              arr[arr.length - 1].user = data.text;
            }
            return arr;
          });
        } else if (data.type === "user-text") {
          setChat(prev => {
            const arr = [...prev];
            if (arr.length > 0) {
              arr[arr.length - 1].user = data.text;
            }
            return arr;
          });
        } else if (data.type === "reply-text") {
          setChat(prev => {
            const arr = [...prev];
            if (arr.length > 0) {
              arr[arr.length - 1].role = data.text;
            }
            return arr;
          });
        } else if (data.type === "reply-audio") {
          const audioDataUrl = "data:audio/wav;base64," + data.audio;
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }
          const audio = new Audio(audioDataUrl);
          audioRef.current = audio;
          audio.play().catch(err => console.error("音频播放失败:", err));
        }
      } catch (err) {
        console.error("[Realtime] 消息解析失败:", err);
      }
    };
    setSocket(ws);

    return () => {
      ws.close();
      if (audioRef.current) audioRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 格式化通话时长
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = async (e) => {
      if (e.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
        const ab = await e.data.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
        socket.send(JSON.stringify({ type: "audio-chunk", chunk: b64, isAgentMode: true }));
      }
    };

    mr.start(250);
    setRecording(true);
    setCallDuration(0);
    
    // 开始计时
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  }

  function stopRecording() {
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop", isAgentMode: true }));
    }
    setRecording(false);
    
    // 停止计时
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // 停止音频流
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }

  // 静音功能
  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  // 免提功能（模拟）
  const toggleSpeakerphone = () => {
    setIsSpeakerphone(prev => !prev);
    // 实际的免提功能需要Web Audio API的更多设置
  };

  // 获取当前角色头像
  const currentAvatar = roleAvatars && selectedRole ? roleAvatars[selectedRole.name] : "🤖";
  // 获取当前角色名称
  const currentRoleName = selectedRole ? selectedRole.name : "AI语音助手";

  return (
    <div className="realtime-chat-page">
      <div className="realtime-chat-header">
        <button className="realtime-back-button" onClick={onExit} style={{ opacity: recording ? 0.6 : 1, cursor: recording ? 'not-allowed' : 'pointer' }} disabled={recording}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5 30.5L8.5 20L18.5 9.5" stroke="#2F88FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M26.5 30.5L16.5 20L26.5 9.5" stroke="#43CCF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2>{currentRoleName}实时通话</h2>
        <div className="realtime-duration-display">
          {recording && formatDuration(callDuration)}
        </div>
      </div>

      <div className="realtime-call-container">
        {/* 角色头像 */}
        <div className={`realtime-avatar-container ${isMuted ? 'muted' : ''}`}>
          {currentAvatar}
        </div>
        
        {/* 通话状态显示 */}
        {recording ? (
          <div className="realtime-status-text">
            通话中...
          </div>
        ) : (
          <div className="realtime-status-text">
            准备通话
          </div>
        )}
        
        {/* 通话信息 */}
        <div className="realtime-call-info">
          <div className="realtime-role-name">{currentRoleName}</div>
          <div className="realtime-call-hint">点击开始按钮开始通话</div>
        </div>
        
        {/* 通话记录 */}
        {chat.length > 0 && (
          <div className="realtime-chat-history">
            {chat.map((c, i) => (
              <div key={i} className="realtime-chat-message">
                <div className="realtime-user-text">
                  你: {c.user}
                </div>
                <div className="realtime-ai-text">
                  {currentAvatar}: {c.role}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 通话控制按钮 */}
      {recording ? (
        <div className="realtime-call-controls">
          {/* 辅助功能按钮 */}
          <div className="realtime-auxiliary-buttons">
            <button
              onClick={toggleMute}
              className={isMuted ? 'muted' : ''}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button
              onClick={toggleSpeakerphone}
              className={isSpeakerphone ? 'speakerphone' : ''}
            >
              {isSpeakerphone ? '🔊' : '📱'}
            </button>
          </div>
          
          {/* 挂断按钮 */}
          <button
            onClick={stopRecording}
            className="realtime-hangup-button"
          >
            📞
          </button>
        </div>
      ) : (
        <div className="realtime-combined-buttons">
          <button className="realtime-record-button" onClick={startRecording}>
            🎤 开始通话
          </button>
        </div>
      )}
    </div>
  );
}