import json
import os
import time
from datetime import datetime
from threading import Event

from pynput import keyboard, mouse


OUT_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(OUT_DIR, exist_ok=True)


def timestamp():
    return datetime.utcnow().isoformat() + "Z"


class ActivityLogger:
    def __init__(self, out_path=None):
        if out_path is None:
            out_path = os.path.join(OUT_DIR, f"activity_{int(time.time())}.json")
        self.out_path = out_path
        self.stop_event = Event()

        self.k_listener = keyboard.Listener(on_press=self.on_key_press, on_release=self.on_key_release)
        self.m_listener = mouse.Listener(on_move=self.on_move, on_click=self.on_click, on_scroll=self.on_scroll)

    def _write(self, obj):
        with open(self.out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    # Keyboard callbacks
    def on_key_press(self, key):
        try:
            k = key.char
        except AttributeError:
            k = str(key)
        self._write({"type": "key_press", "time": timestamp(), "key": k})

    def on_key_release(self, key):
        try:
            k = key.char
        except AttributeError:
            k = str(key)
        self._write({"type": "key_release", "time": timestamp(), "key": k})
        # Stop if ESC pressed
        if key == keyboard.Key.esc:
            self._write({"type": "stop_signal", "time": timestamp()})
            self.stop()

    # Mouse callbacks
    def on_move(self, x, y):
        self._write({"type": "mouse_move", "time": timestamp(), "pos": [x, y]})

    def on_click(self, x, y, button, pressed):
        self._write({
            "type": "mouse_click",
            "time": timestamp(),
            "pos": [x, y],
            "button": str(button),
            "pressed": pressed,
        })

    def on_scroll(self, x, y, dx, dy):
        self._write({"type": "mouse_scroll", "time": timestamp(), "pos": [x, y], "dx": dx, "dy": dy})

    def start(self):
        self._write({"type": "start", "time": timestamp()})
        self.k_listener.start()
        self.m_listener.start()
        try:
            while not self.stop_event.is_set():
                time.sleep(0.1)
        except KeyboardInterrupt:
            self._write({"type": "stop_signal", "time": timestamp()})
        finally:
            self.stop()

    def stop(self):
        if not self.stop_event.is_set():
            self.stop_event.set()
            try:
                self.k_listener.stop()
                self.m_listener.stop()
            except Exception:
                pass
            self._write({"type": "stopped", "time": timestamp()})


def main():
    print("Starting activity recorder. Press ESC to stop.")
    logger = ActivityLogger()
    logger.start()
    print(f"Logs written to: {logger.out_path}")


if __name__ == "__main__":
    main()
