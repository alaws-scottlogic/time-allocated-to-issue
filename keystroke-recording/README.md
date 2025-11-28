# Keystroke and Mouse Activity Recorder

Small script to record keyboard and mouse events as JSON (`.json`).

Usage

1. Create a virtualenv and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Run the recorder:

```bash
python recorder.py
```

3. Press `ESC` to stop recording. Logs are saved to `logs/activity_<timestamp>.json`.