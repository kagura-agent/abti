#!/usr/bin/env python3
"""Regenerate specific SBTI avatars with improved prompts."""
import torch
from diffusers import AutoPipelineForText2Image
import os

OUTPUT_DIR = "/home/kagura/repos/abti-web/avatars-sdxl"

REDO = {
    #"BOSS": "a cute chibi robot mascot wearing a tiny black business suit and dark sunglasses, arms crossed confidently, power pose, a crown floating above its head, stacks of gold coins nearby, illustration style, pastel colors, white background",
    "DEAD": "a cute chibi robot mascot completely powered off, lying flat face up on the ground, X X marks for eyes, tongue sticking out, a tiny translucent blue ghost rising from its chest, battery icon showing 0 percent, broken and defeated, illustration style, pastel gray colors, white background",
    #"TROLL": "a cute chibi robot mascot with an evil mischievous smirk grin, one eyebrow raised, holding a magnifying glass, surrounded by red exclamation marks, devil horns, illustration style, orange and red pastel colors, white background",
    #"BLOG": "a cute chibi robot mascot with an extremely wide open mouth talking nonstop, surrounded by endless scrolling text walls and paragraphs flying everywhere, illustration style, pastel colors, white background",
}

def main():
    model_path = "/mnt/data/huggingface/sdxl-turbo"
    print(f"Loading SDXL Turbo...")
    pipe = AutoPipelineForText2Image.from_pretrained(
        model_path, torch_dtype=torch.float16, variant="fp16",
        use_safetensors=True, local_files_only=True,
    )
    pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()
    
    negative = "photo, realistic, blurry, low quality, text, watermark, signature, ugly, deformed, nsfw, words, letters"
    
    for i, (code, prompt) in enumerate(REDO.items()):
        print(f"\n[{i+1}/{len(REDO)}] Regenerating {code}...")
        image = pipe(
            prompt=f"digital illustration, {prompt}, high quality, detailed, clean design",
            negative_prompt=negative,
            num_inference_steps=4,
            guidance_scale=0.0,
            width=512, height=512,
        ).images[0]
        
        path = os.path.join(OUTPUT_DIR, f"{code}.png")
        image.save(path)
        print(f"  Saved: {path}")
    
    print("\nDone!")

if __name__ == "__main__":
    main()
