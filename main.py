import customtkinter as ctk
import json
import os
import threading
from tkinter import filedialog

from ui.main_window import MainWindow

CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "game_path": "",
        "ssh_host": "",
        "ssh_port": 22,
        "ssh_user": "root",
        "ssh_password": "",
        "ssh_key_path": "",
        "server_spt_path": "/root/SPT/"
    }

def save_config(config: dict):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")

    config = load_config()

    app = MainWindow(config, save_config)
    app.mainloop()
