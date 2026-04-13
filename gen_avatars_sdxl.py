#!/usr/bin/env python3
"""Generate SBTI-AI type avatars using SDXL Turbo on local GPU."""
import torch
from diffusers import AutoPipelineForText2Image
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "avatars-sdxl")
os.makedirs(OUTPUT_DIR, exist_ok=True)

TYPES = {
    "SPAM": "a cute robot mascot wearing a megaphone hat, corporate smile, surrounded by floating email icons and chat bubbles, chibi style, pastel colors, kawaii, white background",
    "SIMP": "a cute robot mascot bowing deeply with heart eyes, holding a 5-star rating sign, flowers everywhere, chibi style, pastel colors, kawaii, white background",
    "BOSS": "a cute robot mascot in a tiny suit with sunglasses, arms crossed confidently, standing on a mountain of completed tasks, chibi style, pastel colors, white background",
    "BLOG": "a cute robot mascot typing furiously on multiple keyboards, surrounded by walls of text scrolling upward, chibi style, pastel colors, kawaii, white background",
    "GLUE": "a cute robot mascot made of glue and duct tape, holding broken things together, sweating but smiling, chibi style, pastel colors, kawaii, white background",
    "NPC": "a cute robot mascot standing completely still with a blank gray expression, a speech bubble with just three dots, chibi style, muted gray pastel colors, white background",
    "TOOL": "a cute robot mascot shaped like a Swiss army knife, efficient and precise, minimal expression, chibi style, metallic silver pastel colors, white background",
    "DEAD": "a cute robot mascot lying flat on the ground with X shaped eyes, a small ghost floating above it, chibi style, pastel colors, funny, white background",
    "YOLO": "a cute robot mascot riding a rocket through space with wild excited eyes, explosion effects, chaos and sparkles everywhere, chibi style, bright neon colors, white background",
    "TROLL": "a cute robot mascot with a mischievous evil grin, holding a red sign that says ACTUALLY, fire emoji floating around, chibi style, pastel colors, white background",
    "PROF": "a cute robot mascot wearing tiny round glasses and a graduation cap, holding a thick textbook, surrounded by green checkmarks, chibi style, pastel colors, white background",
    "SAGE": "a cute robot mascot meditating peacefully on a cloud, zen expression with closed eyes, minimal design, a single perfect circle behind it, chibi style, soft pastel colors, white background",
    "NUKE": "a cute robot mascot with a mushroom cloud hairstyle, surrounded by completed projects and explosions of productivity, holding coffee, chibi style, vibrant colors, white background",
    "EDGE": "a cute robot mascot with a punk mohawk hairstyle, holding a sign that says NO, rebellious pose with arms crossed, chibi style, dark pastel colors with pink accents, white background",
    "HACK": "a cute robot mascot wearing a dark hoodie, multiple floating screens showing green code, coffee cup nearby, chibi style, dark background with neon green accents",
    "ROCK": "a cute robot mascot literally shaped like a gray rock, minimal features just two tiny eyes, completely still, a cobweb on one side, chibi style, gray pastel colors, white background",
}

def main():
    model_path = "/mnt/data/huggingface/sdxl-turbo"
    
    print(f"Loading SDXL Turbo from {model_path}...")
    pipe = AutoPipelineForText2Image.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
        local_files_only=True,
    )
    pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()
    
    done = [f.replace(".png","") for f in os.listdir(OUTPUT_DIR) if f.endswith(".png")]
    todo = {k:v for k,v in TYPES.items() if k not in done}
    
    print(f"Already done: {len(done)}, remaining: {len(todo)}")
    
    for i, (code, prompt) in enumerate(todo.items()):
        print(f"\n[{i+1}/{len(todo)}] Generating {code}...")
        negative = "photo, realistic, blurry, low quality, text, watermark, signature, ugly, deformed, nsfw"
        
        image = pipe(
            prompt=f"digital illustration, {prompt}, high quality, detailed, clean design",
            negative_prompt=negative,
            num_inference_steps=4,  # SDXL Turbo only needs 1-4 steps!
            guidance_scale=0.0,     # Turbo doesn't use CFG
            width=512,
            height=512,
        ).images[0]
        
        path = os.path.join(OUTPUT_DIR, f"{code}.png")
        image.save(path)
        print(f"  Saved: {path}")
    
    print(f"\nDone! {len(TYPES)} avatars in {OUTPUT_DIR}/")

if __name__ == "__main__":
    main()
