// 详细日志记录工具 - 用于捕获和分析语音转文字问题
// 使用方法: 在realtime.js中添加一行: import { setupLogger } from './detailed-logger.js'; setupLogger();

import fs from 'fs';
import path from 'path';

// 配置
const LOG_CONFIG = {
  logLevel: 'verbose', // 'verbose', 'normal', 'quiet'
  logFilePath: path.join(process.cwd(), 'detailed-stt-logs.txt'),
  maxLogSize: 5 * 1024 * 1024, // 5MB
  logToConsole: true,
  logToFile: true
};

// 原始console.log和console.error函数
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

// 时间戳格式化函数
function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substr(0, 23);
}

// 写入日志到文件
function writeToLogFile(message) {
  if (!LOG_CONFIG.logToFile) return;
  
  try {
    // 检查文件大小
    if (fs.existsSync(LOG_CONFIG.logFilePath)) {
      const stats = fs.statSync(LOG_CONFIG.logFilePath);
      if (stats.size > LOG_CONFIG.maxLogSize) {
        // 文件过大，创建新的日志文件（添加时间戳）
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substr(0, 19);
        const backupPath = `${LOG_CONFIG.logFilePath}.${timestamp}.bak`;
        fs.renameSync(LOG_CONFIG.logFilePath, backupPath);
      }
    }
    
    // 追加日志
    fs.appendFileSync(LOG_CONFIG.logFilePath, `${getTimestamp()} ${message}\n`, 'utf-8');
  } catch (err) {
    originalConsoleError(`[Logger Error] 无法写入日志文件:`, err);
  }
}

// 增强的日志函数
function enhancedLog(...args) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  if (LOG_CONFIG.logToConsole) {
    originalConsoleLog(`[${getTimestamp()}]`, ...args);
  }
  
  writeToLogFile(message);
}

// 增强的错误日志函数
function enhancedError(...args) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  if (LOG_CONFIG.logToConsole) {
    originalConsoleError(`[${getTimestamp()}]`, ...args);
  }
  
  writeToLogFile(`ERROR: ${message}`);
}

// 替换console函数
function replaceConsoleFunctions() {
  console.log = enhancedLog;
  console.error = enhancedError;
}

// 恢复原始console函数
function restoreConsoleFunctions() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
}

// 监控语音转文字函数
function monitorTranscribeBuffer(transcribeBuffer) {
  return function(buffer) {
    enhancedLog('\n=== 开始语音转文字处理 ===');
    enhancedLog(`接收到的音频数据大小: ${buffer.length} 字节`);
    
    // 记录前16字节的内容，用于格式分析
    const headerSample = buffer.toString('hex', 0, Math.min(16, buffer.length));
    enhancedLog(`音频数据头部16字节 (十六进制): ${headerSample}`);
    
    // 检查是否包含RIFF头
    if (buffer.length >= 4) {
      const hasRiffHeader = buffer.toString('ascii', 0, 4) === 'RIFF';
      enhancedLog(`数据包含RIFF头: ${hasRiffHeader}`);
      if (hasRiffHeader && buffer.length >= 12) {
        const waveHeader = buffer.toString('ascii', 8, 12);
        enhancedLog(`RIFF类型: ${waveHeader}`);
      }
    }
    
    // 调用原始函数，但包装Promise以记录结果
    return transcribeBuffer(buffer).then(result => {
      enhancedLog('语音转文字处理完成');
      enhancedLog(`转文字结果长度: ${result.length} 字符`);
      enhancedLog(`转文字结果内容: ${result}`);
      
      // 检查结果是否包含文件路径信息
      if (result.includes('tmp_recv') || result.includes('path') || result.includes('D:\\')) {
        enhancedError(`⚠️  警告: 转文字结果包含文件路径信息!`);
        enhancedError(`结果内容: ${result}`);
      }
      
      // 检查结果是否包含中文字符
      const hasChinese = /[\u4e00-\u9fa5]/.test(result);
      enhancedLog(`结果包含中文字符: ${hasChinese}`);
      
      enhancedLog('=== 语音转文字处理结束 ===\n');
      return result;
    }).catch(err => {
      enhancedError('语音转文字处理失败:', err);
      throw err;
    });
  };
}

// 监控whisper-cli调用
function monitorWhisperCall(spawn, whisperExec, modelPath, tmpFile) {
  enhancedLog(`准备调用whisper-cli: ${whisperExec}`);
  enhancedLog(`使用模型: ${modelPath}`);
  enhancedLog(`处理文件: ${tmpFile}`);
  
  // 检查文件是否存在
  if (!fs.existsSync(whisperExec)) {
    enhancedError(`错误: whisper-cli可执行文件不存在: ${whisperExec}`);
  }
  if (!fs.existsSync(modelPath)) {
    enhancedError(`错误: 模型文件不存在: ${modelPath}`);
  }
  if (fs.existsSync(tmpFile)) {
    const stats = fs.statSync(tmpFile);
    enhancedLog(`输入WAV文件大小: ${stats.size} 字节`);
  } else {
    enhancedError(`错误: 输入WAV文件不存在: ${tmpFile}`);
  }
  
  // 创建进程并监控输出
  const whisper = spawn(whisperExec, [
    '-m', modelPath,
    '-otxt',
    '-l', 'zh',
    '-np',
    tmpFile
  ]);
  
  enhancedLog('whisper-cli进程已启动');
  
  // 捕获标准输出
  whisper.stdout.on('data', (data) => {
    const output = data.toString().trim();
    enhancedLog(`whisper.stdout: ${output}`);
  });
  
  // 捕获错误输出
  whisper.stderr.on('data', (data) => {
    const error = data.toString().trim();
    enhancedError(`whisper.stderr: ${error}`);
    
    // 特别检查是否包含文件路径信息
    if (error.includes('output_txt: saving output to')) {
      enhancedError(`⚠️  注意: stderr包含文件路径信息: ${error}`);
    }
  });
  
  // 监控进程结束
  whisper.on('close', (code) => {
    enhancedLog(`whisper-cli进程已关闭，退出码: ${code}`);
    
    // 检查可能的输出文件
    const txtFile1 = tmpFile + '.txt';
    const txtFile2 = tmpFile.replace('.wav', '.txt');
    
    enhancedLog(`检查输出文件:`);
    enhancedLog(`- 路径1: ${txtFile1}, 存在: ${fs.existsSync(txtFile1)}`);
    enhancedLog(`- 路径2: ${txtFile2}, 存在: ${fs.existsSync(txtFile2)}`);
    
    // 记录文件内容
    if (fs.existsSync(txtFile1)) {
      try {
        const content = fs.readFileSync(txtFile1, 'utf-8').trim();
        enhancedLog(`路径1文件内容: ${content}`);
      } catch (err) {
        enhancedError(`读取路径1文件失败:`, err);
      }
    }
    
    if (fs.existsSync(txtFile2)) {
      try {
        const content = fs.readFileSync(txtFile2, 'utf-8').trim();
        enhancedLog(`路径2文件内容: ${content}`);
      } catch (err) {
        enhancedError(`读取路径2文件失败:`, err);
      }
    }
  });
  
  whisper.on('error', (err) => {
    enhancedError(`whisper进程错误:`, err);
  });
  
  return whisper;
}

// 监控WebSocket消息处理
function monitorWebSocketMessages(ws) {
  // 保存原始的onmessage处理函数
  const originalOnMessage = ws.onmessage;
  
  // 替换为增强版的处理函数
  ws.onmessage = function(event) {
    try {
      const rawData = event.data.toString();
      enhancedLog(`\n=== 收到WebSocket消息 ===`);
      enhancedLog(`消息大小: ${rawData.length} 字符`);
      
      // 尝试解析JSON
      try {
        const data = JSON.parse(rawData);
        enhancedLog(`消息类型: ${data.type}`);
        
        // 根据消息类型记录更多信息
        if (data.type === 'audio-chunk') {
          enhancedLog(`音频块大小: ${data.chunk ? Buffer.from(data.chunk, 'base64').length : 0} 字节`);
        } else if (data.type === 'user-text') {
          enhancedLog(`用户文本内容: ${data.text}`);
          if (data.text.includes('tmp_recv') || data.text.includes('path') || data.text.includes('D:\\')) {
            enhancedError(`⚠️  警告: 用户文本包含文件路径信息!`);
          }
        } else if (data.type === 'reply-text') {
          enhancedLog(`AI回复文本内容: ${data.text.substring(0, 50)}${data.text.length > 50 ? '...' : ''}`);
        } else if (data.type === 'reply-audio') {
          enhancedLog(`AI回复音频大小: ${data.audio ? Buffer.from(data.audio, 'base64').length : 0} 字节`);
        }
        
        // 调用原始处理函数
        if (originalOnMessage) {
          originalOnMessage.call(this, event);
        }
      } catch (jsonErr) {
        enhancedError(`解析WebSocket消息失败:`, jsonErr);
        enhancedError(`原始消息: ${rawData.substring(0, 100)}${rawData.length > 100 ? '...' : ''}`);
        
        // 即使解析失败，也尝试调用原始处理函数
        if (originalOnMessage) {
          originalOnMessage.call(this, event);
        }
      }
    } catch (err) {
      enhancedError(`处理WebSocket消息时发生错误:`, err);
    }
  };
  
  return ws;
}

// 创建诊断报告
function createDiagnosticReport() {
  const report = {
    timestamp: getTimestamp(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    workingDirectory: process.cwd(),
    logConfig: {
      logLevel: LOG_CONFIG.logLevel,
      logFilePath: LOG_CONFIG.logFilePath,
      logToConsole: LOG_CONFIG.logToConsole,
      logToFile: LOG_CONFIG.logToFile
    },
    fileChecks: {
      whisperCliExists: fs.existsSync(path.join(process.cwd(), '../whisper.cpp/build/bin/Release/whisper-cli.exe')),
      modelExists: fs.existsSync(path.join(process.cwd(), '../whisper.cpp/build/bin/Release/ggml-base.bin'))
    },
    tempFiles: {
      tmpRecvWav: fs.existsSync(path.join(process.cwd(), 'tmp_recv.wav')) ? 
        fs.statSync(path.join(process.cwd(), 'tmp_recv.wav')).size : null,
      tmpRecvWavTxt: fs.existsSync(path.join(process.cwd(), 'tmp_recv.wav.txt')) ? 
        fs.statSync(path.join(process.cwd(), 'tmp_recv.wav.txt')).size : null,
      tmpRecvTxt: fs.existsSync(path.join(process.cwd(), 'tmp_recv.txt')) ? 
        fs.statSync(path.join(process.cwd(), 'tmp_recv.txt')).size : null
    }
  };
  
  const reportPath = path.join(process.cwd(), `diagnostic-report-${Date.now()}.json`);
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    enhancedLog(`诊断报告已创建: ${reportPath}`);
  } catch (err) {
    enhancedError(`创建诊断报告失败:`, err);
  }
  
  return report;
}

// 主设置函数
function setupLogger() {
  // 替换console函数
  replaceConsoleFunctions();
  
  // 记录初始化信息
  enhancedLog('\n======= 详细日志记录器已启动 =======');
  enhancedLog(`日志级别: ${LOG_CONFIG.logLevel}`);
  enhancedLog(`日志文件: ${LOG_CONFIG.logFilePath}`);
  
  // 创建诊断报告
  createDiagnosticReport();
  
  // 返回监控函数，供realtime.js使用
  return {
    monitorTranscribeBuffer,
    monitorWhisperCall,
    monitorWebSocketMessages,
    createDiagnosticReport,
    restoreConsole: restoreConsoleFunctions
  };
}

// 导出函数
export { setupLogger };

// 直接运行时的示例用法
if (import.meta.url === new URL(process.argv[1], import.meta.url).href) {
  // 作为独立脚本运行时，创建一个简单的测试
  const logger = setupLogger();
  
  console.log('这是一个测试日志消息');
  console.error('这是一个测试错误消息');
  
  // 创建测试报告
  const report = logger.createDiagnosticReport();
  console.log('测试报告摘要:', report.platform, report.nodeVersion);
  
  console.log('\n日志记录器测试完成，请查看日志文件: ' + LOG_CONFIG.logFilePath);
}