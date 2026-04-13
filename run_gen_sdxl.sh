#!/bin/bash
cd ~/repos/abti-web
source .venv/bin/activate
unset http_proxy https_proxy all_proxy ALL_PROXY HTTPS_PROXY HTTP_PROXY
python3 gen_avatars_sdxl.py
