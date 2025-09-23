import { useEffect, useRef, useState } from "react";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [chat, setChat] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState(3);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);

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
            
            // 创建音频对象并添加错误处理
            const audio = new Audio();
            audio.src = audioDataUrl;
            
            // 添加事件监听器
            audio.oncanplaythrough = () => {
              console.log('音频加载完成，可以播放');
              audio.play().catch(err => {
                console.error('音频播放错误:', err);
              });
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
        } else {
          console.warn('未知消息类型:', data.type);
        }
      } catch (e) {
        console.error('解析WebSocket消息失败:', e);
      }
    };
    setSocket(ws);

    return () => ws.close();
  }, []);

  useEffect(() => {
    if (socket && roleId && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "config", roleId }));
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      // If socket is still connecting, wait for it to open before sending
      const handleOpen = () => {
        socket.send(JSON.stringify({ type: "config", roleId }));
        socket.removeEventListener('open', handleOpen);
      };
      socket.addEventListener('open', handleOpen);
    }
  }, [socket, roleId]);

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
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>AI Roleplay — 实时语音与文本聊天</h1>

      <div style={{ marginBottom: 12 }}>
        <label>角色: </label>
        <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div style={{ margin: "12px 0" }}>
        {chat.map((c, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div><strong>你:</strong> {c.user}</div>
            <div><strong>AI:</strong> {c.role}</div>
          </div>
        ))}
      </div>

      {/* 添加文本输入框 */}
      <div style={{ marginBottom: 12 }}>
        <input 
          type="text" 
          placeholder="输入文字消息..." 
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              sendTextMessage(e.target.value);
              e.target.value = '';
            }
          }}
          style={{ width: '300px', padding: '8px' }}
        />
        <button onClick={(e) => {
          const input = e.target.previousSibling;
          sendTextMessage(input.value);
          input.value = '';
        }}>发送</button>
      </div>

      <div>
        {!recording ? (
          <button onClick={startRecording}>🎤 开始说话</button>
        ) : (
          <button onClick={stopRecording}>⏹ 停止</button>
        )}
      </div>
    </div>
  );
}
