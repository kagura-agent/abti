#!/bin/bash
set -e
BASE=/mnt/data/huggingface/hf-sd15
MIRROR=https://hf-mirror.com/runwayml/stable-diffusion-v1-5/resolve/main
cd "$BASE"

# Create directory structure
mkdir -p unet vae text_encoder scheduler tokenizer safety_checker feature_extractor

# Move unet file
mv diffusion_pytorch_model.fp16.safetensors unet/ 2>/dev/null || true

# Download remaining files
echo "=== Downloading remaining model files ==="

echo "[1/12] text_encoder model (~500MB)..."
wget -c -q --show-progress "$MIRROR/text_encoder/model.fp16.safetensors" -O text_encoder/model.fp16.safetensors

echo "[2/12] VAE (~160MB)..."
wget -c -q --show-progress "$MIRROR/vae/diffusion_pytorch_model.fp16.safetensors" -O vae/diffusion_pytorch_model.fp16.safetensors

echo "[3/12] config files..."
wget -c -q "$MIRROR/model_index.json" -O model_index.json
wget -c -q "$MIRROR/unet/config.json" -O unet/config.json
wget -c -q "$MIRROR/vae/config.json" -O vae/config.json
wget -c -q "$MIRROR/text_encoder/config.json" -O text_encoder/config.json
wget -c -q "$MIRROR/scheduler/scheduler_config.json" -O scheduler/scheduler_config.json
wget -c -q "$MIRROR/tokenizer/tokenizer_config.json" -O tokenizer/tokenizer_config.json
wget -c -q "$MIRROR/tokenizer/vocab.json" -O tokenizer/vocab.json
wget -c -q "$MIRROR/tokenizer/merges.txt" -O tokenizer/merges.txt
wget -c -q "$MIRROR/tokenizer/special_tokens_map.json" -O tokenizer/special_tokens_map.json
wget -c -q "$MIRROR/feature_extractor/preprocessor_config.json" -O feature_extractor/preprocessor_config.json

echo "=== All downloads complete ==="
du -sh "$BASE"
