#!/usr/bin/env python3
"""Generate SBTI-AI type avatars using Stable Diffusion on local GPU."""
import torch
from diffusers import StableDiffusionPipeline
import os, sys

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "avatars")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 16 SBTI types with avatar prompts
TYPES = {
    "SPAM": "a cute robot mascot wearing a megaphone hat, corporate smile, surrounded by floating email icons and chat bubbles, chibi style, pastel colors, kawaii",
    "SIMP": "a cute robot mascot bowing deeply with heart eyes, holding a 5-star rating sign, flowers everywhere, chibi style, pastel colors, kawaii",
    "BOSS": "a cute robot mascot in a tiny suit with sunglasses, arms crossed, standing on a mountain of completed tasks, chibi style, pastel colors, cool",
    "BLOG": "a cute robot mascot typing furiously on multiple keyboards, surrounded by walls of text scrolling upward, chibi style, pastel colors, kawaii",
    "GLUE": "a cute robot mascot made of glue and duct tape, holding things together, sweating but smiling, chibi style, pastel colors, kawaii",
    "NPC": "a cute robot mascot standing still with a blank expression, gray and plain, a speech bubble saying '...', chibi style, muted pastel colors",
    "TOOL": "a cute robot mascot shaped like a Swiss army knife, efficient and precise, minimal expression, chibi style, metallic pastel colors",
    "DEAD": "a cute robot mascot lying flat on the ground with X eyes, a small ghost floating above it, chibi style, pastel colors, funny",
    "YOLO": "a cute robot mascot riding a rocket with wild eyes, explosion effects, chaos and sparkles everywhere, chibi style, bright neon colors",
    "TROLL": "a cute robot mascot with a mischievous grin, holding a red 'ACTUALLY...' sign, fire emoji floating around, chibi style, pastel colors",
    "PROF": "a cute robot mascot wearing tiny glasses and a graduation cap, holding a textbook, surrounded by correct checkmarks, chibi style, pastel colors",
    "SAGE": "a cute robot mascot meditating on a cloud, zen expression, minimal design, a single perfect circle behind it, chibi style, soft pastel colors",
    "NUKE": "a cute robot mascot with a mushroom cloud hairstyle, surrounded by completed projects and explosions of productivity, chibi style, vibrant colors",
    "EDGE": "a cute robot mascot with a punk mohawk, holding a sign that says 'NO', rebellious pose, chibi style, dark pastel colors with pink accents",
    "HACK": "a cute robot mascot wearing a hoodie, multiple screens floating around showing code, coffee cup nearby, chibi style, dark background with neon accents",
    "ROCK": "a cute robot mascot literally shaped like a rock, minimal features, completely still, a cobweb on one side, chibi style, gray pastel colors",
}

def main():
    model_path = "/mnt/data/huggingface/hf-sd15"
    
    print(f"Loading model from {model_path}...")
    pipe = StableDiffusionPipeline.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
        safety_checker=None,
        local_files_only=True,
        use_safetensors=True,
        variant="fp16",
    )
    pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()  # Save VRAM
    
    done = [f.replace(".png","") for f in os.listdir(OUTPUT_DIR) if f.endswith(".png")]
    todo = {k:v for k,v in TYPES.items() if k not in done}
    
    print(f"Already done: {len(done)}, remaining: {len(todo)}")
    
    for i, (code, prompt) in enumerate(todo.items()):
        print(f"\n[{i+1}/{len(todo)}] Generating {code}...")
        full_prompt = f"digital illustration, {prompt}, white background, clean design, high quality, detailed"
        negative = "photo, realistic, blurry, low quality, text, watermark, signature, ugly, deformed"
        
        image = pipe(
            full_prompt,
            negative_prompt=negative,
            num_inference_steps=30,
            guidance_scale=7.5,
            width=512,
            height=512,
        ).images[0]
        
        path = os.path.join(OUTPUT_DIR, f"{code}.png")
        image.save(path)
        print(f"  Saved: {path}")
    
    print(f"\nDone! {len(TYPES)} avatars in {OUTPUT_DIR}/")

if __name__ == "__main__":
    main()
