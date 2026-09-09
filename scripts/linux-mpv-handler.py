#!/usr/bin/env python3

import base64
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def decode_urlsafe_base64(value: str) -> str:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(f'{value}{padding}').decode('utf-8')


def read_config_value(config_path: Path, key: str) -> str:
    if not config_path.is_file():
        return ''

    pattern = re.compile(rf'^\s*#?\s*{re.escape(key)}\s*=\s*"([^"]*)"\s*$')
    for line in config_path.read_text(encoding='utf-8').splitlines():
        match = pattern.match(line)
        if match:
            return match.group(1).strip()
    return ''


def resolve_mpv_command(config_path: Path) -> list[str]:
    configured_mpv = read_config_value(config_path, 'mpv')
    if configured_mpv:
        return [configured_mpv]
    return ['mpv']


def get_ipc_socket_path(config_path: Path) -> str:
    configured_socket = read_config_value(config_path, 'ipc_socket')
    if configured_socket:
        return configured_socket

    return os.environ.get('MPV_HANDLER_IPC_SOCKET', '').strip()


def try_enqueue_via_ipc(ipc_socket_path: str, target_url: str, title: str) -> bool:
    if not ipc_socket_path:
        return False

    socket_path = Path(ipc_socket_path).expanduser()
    if not socket_path.exists():
        return False

    # Try with per-entry title first, then fallback to plain append if unsupported.
    commands = [
        {'command': ['loadfile', target_url, 'append-play', f'force-media-title={title}']} if title else {'command': ['loadfile', target_url, 'append-play']},
        {'command': ['loadfile', target_url, 'append-play']},
    ]

    for command in commands:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(0.4)
                client.connect(str(socket_path))
                client.sendall((json.dumps(command) + '\n').encode('utf-8'))
            return True
        except Exception:
            continue

    return False


def build_mpv_command(target_url: str, title: str, config_path: Path) -> list[str]:
    command = resolve_mpv_command(config_path)
    ipc_socket_path = get_ipc_socket_path(config_path)

    if ipc_socket_path:
        expanded_socket = str(Path(ipc_socket_path).expanduser())
        # Ensure new mpv instances expose the same IPC socket for future append requests.
        command.append(f'--input-ipc-server={expanded_socket}')

    if title:
        command.append(f'--force-media-title={title}')
    command.append(target_url)
    return command


def parse_protocol_url(raw_url: str) -> tuple[str, str, str]:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {'mpv-handler', 'mpv-handler-debug'}:
        raise ValueError(f'Unsupported scheme: {parsed.scheme}')

    path_segments = [segment for segment in parsed.path.split('/') if segment]
    if not path_segments or path_segments[0] != 'play':
        raise ValueError('Unsupported mpv-handler plugin')
    if len(path_segments) < 2:
        raise ValueError('Missing encoded media URL')

    target_url = decode_urlsafe_base64(path_segments[1])
    query = parse_qs(parsed.query)
    title = ''
    if query.get('v_title'):
        title = decode_urlsafe_base64(query['v_title'][0])
    enqueue_mode = (query.get('enqueue') or [''])[0].strip().lower()
    return target_url, title, enqueue_mode


def main() -> int:
    if len(sys.argv) < 2:
        print('Expected protocol URL argument', file=sys.stderr)
        return 1

    try:
        target_url, title, enqueue_mode = parse_protocol_url(sys.argv[1])
    except Exception as error:
        print(f'Failed to parse mpv-handler URL: {error}', file=sys.stderr)
        return 1

    config_home = os.environ.get('XDG_CONFIG_HOME', '').strip()
    config_dir = Path(config_home) / 'mpv-handler' if config_home else Path.home() / '.config' / 'mpv-handler'
    config_path = config_dir / 'config.toml'

    if enqueue_mode == 'append':
        ipc_socket_path = get_ipc_socket_path(config_path)
        if try_enqueue_via_ipc(ipc_socket_path, target_url, title):
            return 0

    command = build_mpv_command(target_url, title, config_path)

    try:
        subprocess.Popen(command)
    except Exception as error:
        print(f'Failed to launch mpv: {error}', file=sys.stderr)
        return 1

    return 0


if __name__ == '__main__':
    raise SystemExit(main())