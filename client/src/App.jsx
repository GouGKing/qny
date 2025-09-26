import { useEffect, useRef, useState } from "react";
import RealtimeChat from "./components/RealtimeChat";
import './App.css';

// 定义角色头像映射
const roleAvatars = {
  "Socrates": "👴", // 学者老人
  "Young Wizard": "🧙‍♂️", // 巫师
  "英语听力播报": "🎙️", // 麦克风
  "厨艺专家": "👩‍🍳", // 厨师
  "孔子": "🎓", // 毕业帽/学者
  "面试官": "💼" // 公文包
};

export default function App() {
  const [socket, setSocket] = useState(null);
  const [chat, setChat] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false); // 新增：跟踪是否已暂停播放
  const [isAgentMode, setIsAgentMode] = useState(false); // 新增：跟踪是否处于智能体对话模式
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null); // 新增：音频对象引用，用于控制播放
  const [showRealtime, setShowRealtime] = useState(false); // 新增：是否显示实时聊天窗口
  // 新增：搜索相关状态
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredRoles, setFilteredRoles] = useState([]);

  useEffect(() => {
    fetch("http://localhost:3000/api/roles")
      .then(r => r.json())
      .then(data => {
        setRoles(data);
        setFilteredRoles(data); // 初始时显示所有角色
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
        // 不再为user-text类型消息添加新的聊天记录，避免重复显示
        else if (data.type === "user-text") {
          console.log('收到用户文本消息确认:', data.text);
          // 更新聊天记录中最后一条消息的用户文本
          setChat(prev => {
            if (prev.length === 0) {
              // 如果聊天记录为空，创建新的对话条目
              return [{ user: data.text, role: "AI正在思考..." }];
            }
            const arr = [...prev];
            arr[arr.length - 1].user = data.text;
            return arr;
          });
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
  
  // 新增：处理搜索输入
  const handleSearchChange = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);
    
    // 根据搜索词过滤角色
    if (term.trim() === '') {
      setFilteredRoles(roles);
    } else {
      const filtered = roles.filter(role => 
        role.name.toLowerCase().includes(term) ||
        role.feature1.toLowerCase().includes(term) ||
        role.feature2.toLowerCase().includes(term) ||
        role.feature3.toLowerCase().includes(term)
      );
      setFilteredRoles(filtered);
    }
  };

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = mr;

    // 在开始录音时，先更新UI显示'用户正在说话'
    setChat(prev => [...prev, { user: "用户正在说话", role: "AI正在思考..." }]);

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
      // 再发送给服务器，包含智能体模式标识
      socket.send(JSON.stringify({ 
        type: "text", 
        text, 
        isAgentMode 
      }));
      // 重置暂停状态
      setIsPaused(false);
    }
  };

  // 新增：重新生成AI回复
  const regenerateReply = (index) => {
    if (socket && socket.readyState === WebSocket.OPEN && chat[index]) {
      console.log('重新生成AI回复，消息索引:', index);
      
      // 重点修复：完全停止并清理当前正在播放或加载的音频
      if (audioRef.current) {
        console.log('重新生成时停止当前音频播放');
        audioRef.current.pause();
        audioRef.current = null; // 清空引用以避免旧音频后续加载完成后播放
      }
      
      // 更新UI显示"AI正在思考..."
      setChat(prev => {
        const newChat = [...prev];
        newChat[index].role = "AI正在思考...";
        return newChat;
      });
      
      // 发送重新生成请求到服务器
      const userMessage = chat[index].user;
      socket.send(JSON.stringify({ type: "regenerate", text: userMessage }));
      
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
      {showRealtime ? (
        // 实时聊天窗口
        <RealtimeChat 
          onExit={() => setShowRealtime(false)} 
          roleAvatars={roleAvatars} 
          selectedRole={selectedRole}
        /> 
      ) : showHome ? (
        // 主页界面
        <div className="home-page">
          <h1 className="main-title">AI 对话角色选择</h1>
          
          {/* 新增：搜索框 */}
          <div className="search-container">
            <input
              type="text"
              className="search-input"
              placeholder="搜索角色..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
            {searchTerm && (
              <button
                className="clear-search-button"
                onClick={() => {
                  setSearchTerm('');
                  setFilteredRoles(roles);
                }}
              >
                ×
              </button>
            )}
          </div>
          
          {/* 显示搜索结果数量 */}
          {searchTerm && (
            <div className="search-results-info">
              找到 {filteredRoles.length} 个角色
            </div>
          )}
          
          <div className="roles-grid">
            {filteredRoles.map(role => (
              <div 
                key={role.id} 
                className="role-card" 
                onClick={() => selectRole(role)}
              >
                <div className="role-header">
                    <div className="role-image">{roleAvatars[role.name] || "👤"}</div>
                    <h3 className="role-name">{role.name}</h3>
                  </div>
                <div className="role-features">
                  <div className="feature-item">• {role.feature1}</div>
                <div className="feature-item">• {role.feature2}</div>
                <div className="feature-item">• {role.feature3}</div>
              </div>
            </div>
          ))}
          
          {/* 搜索结果为空时显示 */}
          {filteredRoles.length === 0 && (
            <div className="no-results">
              没有找到匹配的角色
            </div>
          )}
          </div>
        </div>
      ) : (
        // 对话界面
        <div className="chat-page">
          <div className="chat-header">
            <button className="back-button" onClick={goBackToHome}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.5 30.5L8.5 20L18.5 9.5" stroke="#2F88FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M26.5 30.5L16.5 20L26.5 9.5" stroke="#43CCF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <h2><span className="role-image-header">{roleAvatars[selectedRole?.name] || "👤"}</span> {selectedRole?.name}</h2>
            <button className="robot-button" onClick={() => setShowRealtime(true)}>
            {roleAvatars[selectedRole?.name]}通话
           </button>
          </div>
          
          <div className="chat-container">
            {chat.map((c, i) => (
              <div key={i} className="chat-message">
                <div className="user-message"> {c.user}</div>
                <div className="ai-message"><strong>{roleAvatars[selectedRole?.name] || "🤖"} :</strong> {c.role}</div>
                {/* 在AI回复下方添加重新生成按钮 */}
                {/* 只有最后一个AI回复才显示重新生成按钮 */}
                {i === chat.length - 1 && (
                  <button 
                    className="regenerate-button" 
                    onClick={() => regenerateReply(i)}
                    disabled={c.role === "AI正在思考..."}
                  >
                    🔄 重新生成
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="input-container">
            <textarea 
              placeholder="输入文字消息... (Enter发送，Shift+Enter换行)" 
              className="text-input"
              rows="3"
              onKeyDown={(e) => {
                // Shift+Enter插入换行符
                if (e.key === 'Enter' && e.shiftKey) {
                  // 不需要阻止默认行为，因为textarea默认支持Enter换行
                  // 这里可以添加其他处理逻辑(如果需要)
                }
                // 单独按Enter发送消息
                else if (e.key === 'Enter') {
                  e.preventDefault();
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

          <div className="combined-buttons">
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
            
            {/* 开始说话/停止按钮 */}
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
