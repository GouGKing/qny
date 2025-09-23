#!/usr/bin/env python3
import sys
import os
import wave
import re
from piper import PiperVoice

# 检测文本中是否包含中文字符
def contains_chinese(text):
    return bool(re.search(r'[\u4e00-\u9fa5]', text))

# 生成中文提示音（替代中文发音）
def generate_chinese_prompt_sound(output_path):
    sample_rate = 22050
    duration = 1.5  # 1.5秒
    amplitude = 0.3
    
    # 生成一个简单的双音提示音
    num_samples = int(sample_rate * duration)
    audio_data = bytearray()
    
    for i in range(num_samples):
        t = i / sample_rate
        # 前0.5秒是440Hz的A音
        if t < 0.5:
            freq = 440
        # 后1秒是523Hz的C音
        else:
            freq = 523
        
        sample = int(math.sin(2 * math.pi * freq * t) * amplitude * 32767)
        audio_data.extend(sample.to_bytes(2, byteorder='little', signed=True))
    
    # 写入WAV文件
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)       # 单声道
        wf.setsampwidth(2)       # 16位PCM
        wf.setframerate(sample_rate)
        wf.writeframes(audio_data)

import math

def main():
    print("[TTS] 启动TTS服务")
    if len(sys.argv) < 3:
        print("Usage: python tts.py <text_or_textfile> <output_path>")
        sys.exit(1)

    input_arg = sys.argv[1]
    output_path = sys.argv[2]
    print(f"[TTS] 输入参数: {input_arg}, 输出文件: {output_path}")

    # 读取文本
    if os.path.exists(input_arg) and input_arg.lower().endswith(".txt"):
        with open(input_arg, "r", encoding="utf-8") as f:
            text = f.read()
        print(f"[TTS] 从文件读取文本完成")
    else:
        text = input_arg
        print(f"[TTS] 直接使用输入文本")
    
    # 检查是否包含中文字符
    if contains_chinese(text):
        print("[Warning] 检测到中文字符，但当前使用的是英文语音模型")
        print("[Warning] 英文模型无法正确发音中文内容，建议安装中文TTS模型")

    print(f"[TTS] 生成语音文本长度: {len(text)} 字符")
    # 显示文本前30个字符用于调试
    print(f"[TTS] 文本预览: {text[:30]}{'...' if len(text) > 30 else ''}")
    
    # 如果文本包含中文但我们没有中文模型，我们可以提供一个友好的提示
    if contains_chinese(text):
        # 生成一个提示音替代中文发音
        print("[TTS] 正在为中文文本生成提示音")
        generate_chinese_prompt_sound(output_path)
        print(f"[Success] 已生成中文提示音: {output_path}")
        sys.exit(0)

    # 获取模型绝对路径
    MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices", "en_US-libritts-high.onnx")
    if not os.path.exists(MODEL_PATH):
        print(f"[Error] 模型不存在: {MODEL_PATH}")
        sys.exit(1)

    print("[Loading] 正在加载 Piper 模型...")
    try:
        # 加载Piper语音模型（piper-tts 1.3.0版本）
        voice = PiperVoice.load(MODEL_PATH)
        print("[Success] 模型加载成功")
    except Exception as e:
        print(f"[Error] 模型加载失败: {e}")
        sys.exit(1)

    print("[Processing] 正在生成音频...")
    try:
        # 对于piper-tts 1.3.0，我们发现AudioChunk对象有audio_int16_bytes属性
        audio_data = b''
        
        # 获取音频参数
        sample_rate = 22050  # 默认采样率
        
        # 迭代生成器获取所有音频数据
        for chunk in voice.synthesize(text):
            # 使用audio_int16_bytes属性获取PCM字节数据
            if hasattr(chunk, 'audio_int16_bytes'):
                audio_data += chunk.audio_int16_bytes
                # 获取真实的采样率
                if hasattr(chunk, 'sample_rate'):
                    sample_rate = chunk.sample_rate
            else:
                print(f"[Warning] chunk没有audio_int16_bytes属性")
        
        if not audio_data:
            print("[Error] 没有生成任何音频数据")
            sys.exit(1)
        
        print(f"[Success] 音频数据生成成功，大小: {len(audio_data)} 字节")
        
        # 写入WAV文件（添加正确的WAV头部）
        with wave.open(output_path, "wb") as wf:
            wf.setnchannels(1)       # 单声道
            wf.setsampwidth(2)       # 16位PCM
            wf.setframerate(22050)   # 采样率
            wf.writeframes(audio_data)
        
        print(f"[Success] 成功生成音频文件: {output_path} ({os.path.getsize(output_path)} 字节)")
    except Exception as e:
        print(f"[Error] 音频生成失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
