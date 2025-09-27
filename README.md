## 快速开始

### 前置要求
1. 安装Node.js (v14+)
2. 安装Python (v3.7+，用于TTS功能)
3. 安装Ollama并下载运行Mistral模型（如果不需要本地可以直接切换使用deepseek模型）
4. 安装ffmpeg并添加到系统环境变量

### 安装与运行

```bash
# 克隆项目（如果尚未克隆）
# git clone <项目仓库地址>
# cd ai-roleplay

# 安装前端依赖并构建
cd client
npm install
npm run build

# 安装后端依赖并初始化数据库
cd ../server
npm install
npm run init-db

# 安装Python依赖（用于TTS功能）
pip install piper-tts numpy

# 启动Ollama服务（需单独终端）
# ollama pull mistral
# ollama run mistral

# 启动服务器
npm start
```

### 访问应用
服务器启动后，通过浏览器访问 `http://localhost:3000` 来使用应用。

## 开发日志

day1and2
初步想法为不使用成熟LLM模型，使用免费本地LLM模型跑通，后续使用成熟LLM模型进行替换
前端：react + vite
后端：node.js
本地LLM模型：ollama 拉取运行 mistral
声音处理：whisper piper python
实时对话：websocket

day3
目前已完成前端极简样式
整个流程目前文本对话ai语音回复已完成，发语音转文本目前已做但未测试，实时对话未开始
添加了中英文男女生的语音包，利用python可以添加关键点调试使ai回复更加顺畅但具体得看后续时间是否充足
想法是使用node本地部署或者docker部署

day4
更新界面UI，添加重新生成AI回复按钮，添加输入文本框换行逻辑，添加新角色
修复了文本转语音时两段话之间会有噪音bug
更换whisper识别模型由base升级为medium，语音输入转文本目前已完成，精密度有待测试。

day5
新建实时对话界面（尚未完善），更新角色形象，添加新角色
发送语音转文本已实现，目前实时对话正在调试
搜索角色功能添加

day6
基本功能完善，模型切换，连续发语音，生成操作文档，编写思考回答问题文档