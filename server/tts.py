#!/usr/bin/env python3
import sys
import os
import wave
import re
import math
import numpy as np
from piper import PiperVoice

# 检测文本中是否包含中文字符
def contains_chinese(text):
    return bool(re.search(r'[\u4e00-\u9fa5]', text))

# 生成静音片段（ms）
def generate_silence(duration_ms, sample_rate=22050):
    samples = int(sample_rate * duration_ms / 1000)
    return np.zeros(samples, dtype=np.int16).tobytes()

def main():
    print("[TTS] 启动TTS服务")
    if len(sys.argv) < 3:
        print("Usage: python tts.py <text_or_textfile> <output_path> [voice_model]")
        sys.exit(1)

    input_arg = sys.argv[1]
    output_path = sys.argv[2]
    voice_model = sys.argv[3] if len(sys.argv) >= 4 else None
    print(f"[TTS] 输入参数: {input_arg}, 输出文件: {output_path}, 语音模型: {voice_model}")

    # 读取文本
    if os.path.exists(input_arg) and input_arg.lower().endswith(".txt"):
        with open(input_arg, "r", encoding="utf-8") as f:
            text = f.read()
        print(f"[TTS] 从文件读取文本完成")
    else:
        text = input_arg
        print(f"[TTS] 直接使用输入文本")
    
    has_chinese = contains_chinese(text)
    print(f"[TTS] 检测到中文字符: {has_chinese}")
    print(f"[TTS] 生成语音文本长度: {len(text)} 字符")
    print(f"[TTS] 文本预览: {text[:30]}{'...' if len(text) > 30 else ''}")

    voices_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
    
    if voice_model:
        MODEL_PATH = os.path.join(voices_dir, voice_model)
        if not os.path.exists(MODEL_PATH):
            print(f"[Error] 指定的模型不存在: {MODEL_PATH}")
            sys.exit(1)
    else:
        if has_chinese:
            MODEL_PATH = os.path.join(voices_dir, "zh_CN-huayan-medium.onnx")
            if not os.path.exists(MODEL_PATH):
                print(f"[Warning] 中文女中音模型不存在，回退到基础中文模型")
                MODEL_PATH = os.path.join(voices_dir, "zh_CN-huayan-x_low.onnx")
                if not os.path.exists(MODEL_PATH):
                    print(f"[Warning] 中文模型不存在，回退到英文模型")
                    MODEL_PATH = os.path.join(voices_dir, "en_US-libritts-high.onnx")
        else:
            MODEL_PATH = os.path.join(voices_dir, "en_US-libritts-high.onnx")

        if not os.path.exists(MODEL_PATH):
            print(f"[Error] 模型不存在: {MODEL_PATH}")
            sys.exit(1)
    
    print(f"[TTS] 选择的语音模型: {os.path.basename(MODEL_PATH)}")

    print("[Loading] 正在加载 Piper 模型...")
    try:
        voice = PiperVoice.load(MODEL_PATH)
        print("[Success] 模型加载成功")
    except Exception as e:
        print(f"[Error] 模型加载失败: {e}")
        sys.exit(1)

    print("[Processing] 正在生成音频...")
    try:
        is_huayan_medium = 'zh_CN-huayan-medium.onnx' in MODEL_PATH
        audio_data = b''
        sample_rate = 22050  # 默认采样率

        if is_huayan_medium:
            punctuation_pauses = {
                ',': 200, '，': 200,
                '.': 500, '。': 500,
                '!': 500, '！': 500,
                '?': 500, '？': 500,
                ';': 300, '；': 300,
                ':': 300, '：': 300,
                '-': 200, '—': 300
            }

            # 分割为句子（主要标点）
            segments = re.split(r'([。.!！？?])', text)
            if len(segments) % 2 != 0:
                segments.append('')

            for i in range(0, len(segments), 2):
                sentence = segments[i].strip()
                punct = segments[i+1]

                if sentence:
                    # 直接 synthesize 整个句子，减少分段
                    for chunk in voice.synthesize(sentence):
                        if hasattr(chunk, 'audio_int16_bytes'):
                            audio_data += chunk.audio_int16_bytes
                            if hasattr(chunk, 'sample_rate'):
                                sample_rate = chunk.sample_rate

                if punct in punctuation_pauses:
                    audio_data += generate_silence(punctuation_pauses[punct], sample_rate)

        else:
            # 英文或其他模型，直接一次性合成
            for chunk in voice.synthesize(text):
                if hasattr(chunk, 'audio_int16_bytes'):
                    audio_data += chunk.audio_int16_bytes
                    if hasattr(chunk, 'sample_rate'):
                        sample_rate = chunk.sample_rate

        if not audio_data:
            print("[Error] 没有生成任何音频数据")
            sys.exit(1)

        print(f"[Success] 音频数据生成成功，大小: {len(audio_data)} 字节")
        
        with wave.open(output_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)
        
        print(f"[Success] 成功生成音频文件: {output_path} ({os.path.getsize(output_path)} 字节)")
    except Exception as e:
        print(f"[Error] 音频生成失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
