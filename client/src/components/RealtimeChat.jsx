import { useEffect, useRef, useState } from "react";
import './RealtimeChat.css';

export default function RealtimeChat({ onExit, roleAvatars, selectedRole }) {
  const [socket, setSocket] = useState(null);
  const [chat, setChat] = useState([]);
  const [recording, setRecording] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerphone, setIsSpeakerphone] = useState(false);
  const [interviewMode, setInterviewMode] = useState(false);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [interviewProgress, setInterviewProgress] = useState(0);
  const [interviewQuestions, setInterviewQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [interviewEvaluation, setInterviewEvaluation] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3000");
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

  // 面试问题库
  const getInterviewQuestions = (roleName) => {
    const generalQuestions = [
      "请简单介绍一下您自己",
      "您为什么选择这个职业方向？",
      "您认为自己的最大优点是什么？",
      "请描述一次您解决困难问题的经历",
      "您如何保持学习和自我提升？",
      "请谈谈您的职业规划",
      "您如何处理工作中的压力？",
      "您认为团队合作中最重要的因素是什么？",
      "请描述一次您领导团队的经历",
      "您如何平衡工作与生活？"
    ];

    const roleSpecificQuestions = {
      "Socrates": [
        "您如何定义真理？",
        "请描述一次您质疑权威的经历",
        "您认为什么是真正的智慧？",
        "如何培养批判性思维？",
        "请谈谈您对教育的理解"
      ],
      "Young Wizard": [
        "您如何面对未知的挑战？",
        "请描述一次您探索新事物的经历",
        "您认为冒险精神在职业发展中重要吗？",
        "如何保持对世界的好奇心？",
        "请谈谈您的创新思维"
      ],
      "英语听力播报": [
        "您如何提高自己的沟通能力？",
        "请描述一次您克服语言障碍的经历",
        "您认为语言学习最重要的是什么？",
        "如何保持学习的持续性？",
        "请谈谈您的学习方法"
      ],
      "厨艺专家": [
        "您如何培养专业技能？",
        "请描述一次您创新工作的经历",
        "您认为专业精神体现在哪里？",
        "如何保持对工作的热情？",
        "请谈谈您的质量意识"
      ],
      "孔子": [
        "您如何理解仁爱精神？",
        "请描述一次您帮助他人的经历",
        "您认为品德修养重要吗？",
        "如何传承优秀文化？",
        "请谈谈您的教育理念"
      ],
      "面试官": [
        "您如何评估他人的能力？",
        "请描述一次您做重要决策的经历",
        "您认为公平公正重要吗？",
        "如何建立良好的人际关系？",
        "请谈谈您的沟通技巧"
      ]
    };

    const questions = roleSpecificQuestions[roleName] || generalQuestions;
    return questions.slice(0, 5); // 选择5个问题
  };

  // 开始面试模式
  const startInterviewMode = () => {
    setInterviewMode(true);
    setInterviewStarted(false);
    setInterviewProgress(0);
    setCurrentQuestionIndex(0);
    setInterviewEvaluation(null);
    setChat([]);
    
    const questions = getInterviewQuestions(currentRoleName);
    setInterviewQuestions(questions);
  };

  // 开始面试
  const startInterview = () => {
    setInterviewStarted(true);
    setInterviewProgress(0);
    
    // 发送面试开始消息
    if (socket && socket.readyState === WebSocket.OPEN) {
      const firstQuestion = interviewQuestions[0];
      socket.send(JSON.stringify({ 
        type: "interview-start", 
        question: firstQuestion,
        roleName: currentRoleName 
      }));
    }
  };

  // 结束面试
  const endInterview = () => {
    setInterviewMode(false);
    setInterviewStarted(false);
    setInterviewProgress(0);
    setCurrentQuestionIndex(0);
    setInterviewQuestions([]);
    setChat([]);
    
    // 生成面试评估
    if (chat.length > 0) {
      generateInterviewEvaluation();
    }
  };

  // 生成面试评估
  const generateInterviewEvaluation = () => {
    const evaluation = {
      score: Math.floor(Math.random() * 30) + 70, // 70-100分
      strengths: [
        "回答思路清晰",
        "表达能力强",
        "逻辑思维好",
        "态度积极"
      ].slice(0, Math.floor(Math.random() * 3) + 2),
      improvements: [
        "可以更具体地举例说明",
        "建议加强专业知识学习",
        "注意回答的完整性",
        "可以更加自信一些"
      ].slice(0, Math.floor(Math.random() * 2) + 1),
      overallComment: "整体表现良好，建议继续提升专业技能和沟通能力。"
    };
    setInterviewEvaluation(evaluation);
  };

  // 下一题
  const nextQuestion = () => {
    if (currentQuestionIndex < interviewQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      setInterviewProgress((nextIndex / interviewQuestions.length) * 100);
      
      // 发送下一题
      if (socket && socket.readyState === WebSocket.OPEN) {
        const nextQuestion = interviewQuestions[nextIndex];
        socket.send(JSON.stringify({ 
          type: "interview-question", 
          question: nextQuestion,
          questionIndex: nextIndex 
        }));
      }
    } else {
      // 面试结束
      endInterview();
    }
  };

  return (
    <div className="realtime-chat-page">
      <div className="realtime-chat-header">
        <button className="realtime-back-button" onClick={onExit} style={{ opacity: recording ? 0.6 : 1, cursor: recording ? 'not-allowed' : 'pointer' }} disabled={recording}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5 30.5L8.5 20L18.5 9.5" stroke="#2F88FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M26.5 30.5L16.5 20L26.5 9.5" stroke="#43CCF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2>
          {interviewMode ? `${currentRoleName}AI面试` : `${currentRoleName}实时通话`}
        </h2>
        <div className="realtime-duration-display">
          {recording && formatDuration(callDuration)}
          {interviewMode && !interviewStarted && (
            <button className="interview-mode-toggle" onClick={() => setInterviewMode(false)}>
              退出面试
            </button>
          )}
        </div>
      </div>

      <div className="realtime-call-container">
        {/* 角色头像 */}
        <div className={`realtime-avatar-container ${isMuted ? 'muted' : ''}`}>
          {currentAvatar}
        </div>
        
        {/* 面试模式特定显示 */}
        {interviewMode ? (
          <>
            {/* 面试状态显示 */}
            {interviewStarted ? (
              <div className="realtime-status-text interview-status">
                面试进行中... (第 {currentQuestionIndex + 1} 题 / 共 {interviewQuestions.length} 题)
              </div>
            ) : (
              <div className="realtime-status-text">
                准备开始面试
              </div>
            )}
            
            {/* 面试进度条 */}
            {interviewStarted && (
              <div className="interview-progress-container">
                <div className="interview-progress-bar">
                  <div 
                    className="interview-progress-fill" 
                    style={{ width: `${interviewProgress}%` }}
                  ></div>
                </div>
                <div className="interview-progress-text">
                  {Math.round(interviewProgress)}% 完成
                </div>
              </div>
            )}
            
            {/* 当前面试问题 */}
            {interviewStarted && interviewQuestions[currentQuestionIndex] && (
              <div className="current-interview-question">
                <h4>当前问题：</h4>
                <p>{interviewQuestions[currentQuestionIndex]}</p>
              </div>
            )}
            
            {/* 面试信息 */}
            <div className="realtime-call-info">
              <div className="realtime-role-name">{currentRoleName}</div>
              <div className="realtime-call-hint">
                {interviewStarted ? "请回答问题，然后点击下一题" : "点击开始按钮开始面试"}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 普通通话状态显示 */}
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
          </>
        )}
        
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
        
        {/* 面试评估结果 */}
        {interviewEvaluation && (
          <div className="interview-evaluation">
            <h3>面试评估结果</h3>
            <div className="evaluation-score">
              综合评分: <span className="score-number">{interviewEvaluation.score}</span> 分
            </div>
            <div className="evaluation-details">
              <div className="strengths">
                <h4>优点:</h4>
                <ul>
                  {interviewEvaluation.strengths.map((strength, i) => (
                    <li key={i}>{strength}</li>
                  ))}
                </ul>
              </div>
              <div className="improvements">
                <h4>改进建议:</h4>
                <ul>
                  {interviewEvaluation.improvements.map((improvement, i) => (
                    <li key={i}>{improvement}</li>
                  ))}
                </ul>
              </div>
              <div className="overall-comment">
                <h4>总体评价:</h4>
                <p>{interviewEvaluation.overallComment}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 控制按钮区域 */}
      {interviewMode ? (
        // 面试模式控制按钮
        <div className="interview-controls">
          {interviewStarted ? (
            <div className="interview-active-controls">
              {/* 面试进行中的控制按钮 */}
              <div className="interview-question-controls">
                <button 
                  className="interview-next-button" 
                  onClick={nextQuestion}
                  disabled={recording}
                >
                  {currentQuestionIndex < interviewQuestions.length - 1 ? '下一题' : '结束面试'}
                </button>
                <button 
                  className="interview-end-button" 
                  onClick={endInterview}
                >
                  提前结束
                </button>
              </div>
              
              {/* 语音控制按钮 */}
              {recording ? (
                <div className="realtime-call-controls">
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
                  <button
                    onClick={stopRecording}
                    className="realtime-hangup-button"
                  >
                    📞
                  </button>
                </div>
              ) : (
                <button className="realtime-record-button" onClick={startRecording}>
                  🎤 开始回答
                </button>
              )}
            </div>
          ) : (
            // 面试开始前的控制按钮
            <div className="interview-start-controls">
              <button className="interview-start-button" onClick={startInterview}>
                🎯 开始面试
              </button>
              <button className="interview-cancel-button" onClick={() => setInterviewMode(false)}>
                取消面试
              </button>
            </div>
          )}
        </div>
      ) : (
        // 普通通话模式控制按钮
        <>
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
              <button className="interview-mode-button" onClick={startInterviewMode}>
                🎯 开始面试
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}