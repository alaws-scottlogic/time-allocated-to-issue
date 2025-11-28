#!/usr/bin/env python3
"""Parse key press events from recorder logs and reconstruct typed sentences.

Usage: python parse_keys.py path/to/logfile
"""
import json
import sys
from pathlib import Path
from datetime import datetime


def normalize_key(k, shift=False):
    # k is the raw value from the log (e.g. 'a', 'Key.space', 'Key.backspace', '"', '\\u0003')
    if k.startswith("Key."):
        name = k.split('.', 1)[1]
        if name == 'space':
            return ' '
        if name == 'enter':
            return '\n'
        if name == 'backspace':
            return None  # signal to remove last char
        # ignore modifier and navigation keys
        return ''
    # control characters (non-printable) — ignore
    if len(k) == 1:
        ch = k
        if ord(ch) < 32:
            return ''
        if shift and ch.isalpha():
            return ch.upper()
        return ch
    # quoted characters like '"' are already a single char
    return k


def parse_log(path: Path):
    buffer = []
    shift = False
    sentences = []

    with path.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get('type') != 'key_press':
                continue
            key = obj.get('key')
            if key is None:
                continue

            # handle shift keys heuristically
            if isinstance(key, str) and key.startswith('Key.shift'):
                shift = True
                continue
            # ignore control-only keys (actual control characters like \u0003)
            if isinstance(key, str) and any(ord(ch) < 32 for ch in key):
                continue

            val = normalize_key(key, shift=shift)
            # reset shift after a single character (heuristic)
            if shift:
                shift = False

            if val is None:
                # backspace: remove last char if any
                if buffer:
                    buffer.pop()
                continue
            if val == '\n':
                # finalize line; strip control chars and skip empty
                s = ''.join(buffer)
                s_clean = ''.join(ch for ch in s if ord(ch) >= 32)
                if s_clean.strip():
                    sentences.append(s_clean)
                buffer = []
                continue
            if val == '':
                continue

            buffer.append(val)

    # final buffer as last sentence — strip control characters and skip empty
    if buffer:
        s = ''.join(buffer)
        s_clean = ''.join(ch for ch in s if ord(ch) >= 32)
        if s_clean.strip():
            sentences.append(s_clean)
    return sentences


def main():
    if len(sys.argv) < 2:
        print('Usage: python parse_keys.py path/to/logfile')
        sys.exit(2)
    path = Path(sys.argv[1])
    if not path.exists():
        print('File not found:', path)
        sys.exit(2)
    sentences = parse_log(path)
    # prepare output file
    ts = datetime.utcnow().isoformat().replace(':', '').replace('-', '')
    out_name = f'parsed_keystrokes_{ts}.json'
    out_path = path.parent / out_name
    out_obj = {
        'source': str(path.name),
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'sentences': sentences,
    }
    with out_path.open('w', encoding='utf-8') as outf:
        json.dump(out_obj, outf, ensure_ascii=False, indent=2)
    print('Wrote parsed output to:', out_path)


if __name__ == '__main__':
    main()
