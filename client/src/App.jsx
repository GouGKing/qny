import { useEffect, useRef, useState } from "react";
import './App.css';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [chat, setChat] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false); // 新增：跟踪是否已暂停播放
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null); // 新增：音频对象引用，用于控制播放

  useEffect(() => {
    fetch("http://localhost:3000/api/roles")
      .then(r => r.json())
      .then(data => {
        setRoles(data);
        // 不要覆盖已经设置的默认角色ID
        console.log('已加载角色列表，当前选择角色ID:', roleId);
      });

    const ws = new WebSocket("ws://localhost:3001");
    ws.onopen = () => console.log("ws open");
    ws.onmessage = (e) => {
      console.log('收到WebSocket消息:', e.data);
      try {
        const data = JSON.parse(e.data);
        console.log('解析消息:', data);
        
        if (data.type === "info") {
          console.log('系统信息:', data.msg);
        } else if (data.type === "error") {
          console.error('服务器错误:', data.msg);
          // 显示错误消息给用户
          alert(`错误: ${data.msg}`);
        } 
        else if (data.type === "user-text") {
          console.log('用户文本消息:', data.text);
          setChat(prev => [...prev, { user: data.text, role: "" }]);
        } 
        else if (data.type === "reply-text") {
          console.log('AI回复文本:', data.text);
          setChat(prev => {
            // 添加安全检查，确保数组不为空
            if (prev.length === 0) {
              console.warn('聊天记录为空，创建新的对话条目');
              return [{ user: "(未捕获到用户输入)", role: data.text }];
            }
            const arr = [...prev];
            arr[arr.length - 1].role = data.text;
            return arr;
          });
        } 
        else if (data.type === "reply-audio") {
          try {
            console.log('收到音频回复，大小:', data.audio.length, '字符');
            const base64Audio = data.audio;
            
            // 直接使用data URL方式播放音频
            const audioDataUrl = "data:audio/wav;base64," + base64Audio;
            
            // 停止当前正在播放的音频（如果有）
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current = null;
            }
            
            // 创建音频对象并添加错误处理
            const audio = new Audio();
            audio.src = audioDataUrl;
            audioRef.current = audio;
            
            // 添加事件监听器
            audio.oncanplaythrough = () => {
              console.log('音频加载完成，可以播放');
              // 如果不是暂停状态，则播放音频
              if (!isPaused) {
                audio.play().catch(err => {
                  console.error('音频播放错误:', err);
                });
              }
            };
            
            audio.onended = () => {
              console.log('音频播放结束');
              // 播放结束后，如果是暂停状态，则重置暂停状态
              if (isPaused) {
                setIsPaused(false);
              }
            };
            
            audio.onerror = (event) => {
              console.error('音频加载错误:', event);
              // 尝试保存音频数据到文件以便调试
              try {
                const byteCharacters = atob(base64Audio);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'audio/wav' });
                
                // 创建下载链接以便用户可以保存和检查音频文件
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.download = 'test-audio.wav';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(downloadLink.href);
                console.log('已创建音频文件下载链接，可用于调试');
              } catch (saveError) {
                console.error('保存音频文件失败:', saveError);
              }
            };
          } catch (error) {
            console.error('处理音频数据失败:', error);
          }
        } else if (data.type === "pause-ack") {
          console.log('服务器确认暂停');
          // 暂停前端音频播放
          if (audioRef.current) {
            audioRef.current.pause();
          }
          setIsPaused(true);
        } else if (data.type === "resume-ack") {
          console.log('服务器确认恢复');
          // 恢复前端音频播放
          if (audioRef.current) {
            audioRef.current.play().catch(err => {
              console.error('恢复播放音频失败:', err);
            });
          }
          setIsPaused(false);
        } else {
          console.warn('未知消息类型:', data.type);
        }
      } catch (e) {
        console.error('解析WebSocket消息失败:', e);
      }
    };
    setSocket(ws);

    return () => {
      // 组件卸载时清理音频对象
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      ws.close();
    };
  }, []);

  // 移除了第二个useEffect钩子，只在selectRole函数中处理角色配置
  // 这样可以避免由于状态变化和副作用导致的复杂问题

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = async (e) => {
      if (e.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
        const ab = await e.data.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
        socket.send(JSON.stringify({ type: "audio-chunk", chunk: b64 }));
      }
    };

    mr.start(250);
    setRecording(true);
  }

  function stopRecording() {
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    setRecording(false);
  }

  // 发送文本消息
  const sendTextMessage = (text) => {
    if (socket && socket.readyState === WebSocket.OPEN && text.trim()) {
      console.log('发送文本消息:', text);
      // 先更新UI显示用户输入
      setChat(prev => [...prev, { user: text, role: "AI正在思考..." }]);
      // 再发送给服务器
      socket.send(JSON.stringify({ type: "text", text }));
      // 重置暂停状态
      setIsPaused(false);
    }
  };

  // 新增：暂停播放
  const pausePlayback = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('发送暂停请求');
      socket.send(JSON.stringify({ type: "pause" }));
    }
  };

  // 新增：恢复播放
  const resumePlayback = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('发送恢复请求');
      socket.send(JSON.stringify({ type: "resume" }));
    }
  };

  // 状态用于控制当前显示的是主页还是对话界面
  const [showHome, setShowHome] = useState(true);
  const [selectedRole, setSelectedRole] = useState(null);

  // 选择角色并进入对话界面
  const selectRole = (role) => {
    setSelectedRole(role);
    setRoleId(role.id); // 设置当前角色ID
    setShowHome(false);
    setChat([]); // 清空聊天记录
    
    // 确保角色配置正确发送到服务器
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('选择角色并立即发送配置:', role.id);
      socket.send(JSON.stringify({ type: "config", roleId: role.id }));
    }
  };

  // 返回主页
  const goBackToHome = () => {
    setShowHome(true);
    setSelectedRole(null);
    setRoleId(null); // 清除角色ID
    setChat([]); // 清空聊天记录
  };

  return (
    <div className="app-container">
      {showHome ? (
        // 主页界面
        <div className="home-page">
          <h1 className="main-title">AI 对话角色选择</h1>
          <div className="roles-grid">
            {roles.map(role => (
              <div 
                key={role.id} 
                className="role-card" 
                onClick={() => selectRole(role)}
              >
                <div className="role-image">👤</div>
                <h3 className="role-name">{role.name}</h3>
                <p className="role-description">{role.description || '与这个AI角色进行对话'}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // 对话界面
        <div className="chat-page">
          <div className="chat-header">
            <button className="back-button" onClick={goBackToHome}>← 返回主页</button>
            <h2>{selectedRole?.name}</h2>
          </div>
          
          <div className="chat-container">
            {chat.map((c, i) => (
              <div key={i} className="chat-message">
                <div className="user-message"><strong>你:</strong> {c.user}</div>
                <div className="ai-message"><strong>AI:</strong> {c.role}</div>
              </div>
            ))}
          </div>

          <div className="input-container">
            <input 
              type="text" 
              placeholder="输入文字消息..." 
              className="text-input"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  sendTextMessage(e.target.value);
                  e.target.value = '';
                }
              }}
            />
            <button className="send-button" onClick={(e) => {
              const input = e.target.previousSibling;
              sendTextMessage(input.value);
              input.value = '';
            }}>发送</button>
          </div>

          <div className="control-buttons">
            {/* 暂停/恢复按钮 */}
            {!isPaused ? (
              <button className="control-button" onClick={pausePlayback} disabled={recording}>
                ⏸ 暂停播放
              </button>
            ) : (
              <button className="control-button" onClick={resumePlayback} disabled={recording}>
                ▶ 继续播放
              </button>
            )}
            <span className="status-text">
              {isPaused ? '已暂停' : ''}
            </span>
          </div>

          <div className="record-buttons">
            {!recording ? (
              <button className="record-button" onClick={startRecording}>🎤 开始说话</button>
            ) : (
              <button className="record-button stop" onClick={stopRecording}>⏹ 停止</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
