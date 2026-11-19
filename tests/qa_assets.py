"""Use the source build by default; CHAT_ASSETS selects a comparison build."""
import os
from pathlib import Path


def chat_entry():
    root = Path(__file__).resolve().parents[1]
    return (Path(os.environ.get('CHAT_ASSETS', root / 'web/dist')) / 'index.html').resolve()
