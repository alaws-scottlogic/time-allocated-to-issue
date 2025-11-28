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

Parser and format notes
-----------------------

- A `reason` field is no longer included on `stop_signal` events; stop signals only include `type` and `time`.
- A helper script `parse_keys.py` is provided to extract typed text from recorded logs.

Parsing behavior
---------------

- The parser reads a recorder log (JSON lines) and reconstructs typed sentences from `key_press` events.
- It handles `Key.space` (as space), `Key.enter` (as newline), and `Key.backspace` (removes previous character).
- Modifier keys like `Key.shift_r` are treated heuristically (applies to the next printable char).
- Control characters (non-printable, e.g. U+0003) are ignored and removed from the final parsed sentences.

Usage of the parser
-------------------

Run the parser against a logfile; it writes a timestamped JSON with parsed sentences next to the source log:

```bash
python parse_keys.py logs/activity_<timestamp>.json
```

The output filename is `logs/parsed_keystrokes_{timestamp}.json` and contains:

- `source`: source logfile name
- `generated_at`: ISO timestamp
- `sentences`: array of reconstructed text entries

If you'd like improvements (better modifier handling, preserving control sequences, or CSV output), tell me what format you prefer and I can add it.
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