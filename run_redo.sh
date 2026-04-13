#!/bin/bash
cd ~/repos/abti-web
source .venv/bin/activate
unset http_proxy https_proxy all_proxy ALL_PROXY
python3 redo_avatars.py
