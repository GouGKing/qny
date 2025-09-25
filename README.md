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
