#!/usr/bin/env python3
"""
run.py — Development server for Liquid Glass PRO demo.

Why we need a proper server (not just open demo.html directly):
  • html2canvas requires same-origin for DOM capture — file:// blocks it
  • ES module imports (type="module") are blocked on file:// in Chrome/Firefox
  • CORS headers needed for WebGL texture upload from canvas

Usage:
  python run.py              # serves on http://localhost:8080
  python run.py --port 3000  # custom port
  python run.py --host 0.0.0.0  # expose to LAN (e.g. test on mobile)

Requirements:
  Python 3.7+  (no pip installs needed – uses stdlib only)
"""

import argparse
import os
import sys
import webbrowser
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


# ── MIME types not in SimpleHTTPRequestHandler defaults ──────────────────────

EXTRA_MIME = {
    '.js':    'application/javascript',
    '.mjs':   'application/javascript',
    '.jsx':   'application/javascript',
    '.ts':    'application/typescript',
    '.wasm':  'application/wasm',
    '.json':  'application/json',
    '.svg':   'image/svg+xml',
    '.webp':  'image/webp',
    '.avif':  'image/avif',
}


class LGHandler(SimpleHTTPRequestHandler):
    """
    Custom request handler that:
      • Adds permissive CORS headers (required for WebGL canvas read-back)
      • Sets correct MIME types for ES modules
      • Suppresses noisy access logs (override log_message to customise)
      • Serves demo.html at '/' for convenience
    """

    def end_headers(self):
        # CORS – allows html2canvas and WebGL to read same-origin canvases
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        # Needed for SharedArrayBuffer / Atomics (optional, future-proof)
        self.send_header('Cross-Origin-Opener-Policy',   'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext in EXTRA_MIME:
            return EXTRA_MIME[ext]
        return super().guess_type(path)

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt, *args):
        # Suppress 304 "Not Modified" noise; show everything else
        if args and str(args[1]) == '304':
            return
        status = args[1] if len(args) > 1 else '?'
        colour = '\033[92m' if str(status).startswith('2') else \
            '\033[93m' if str(status).startswith('3') else '\033[91m'
        reset  = '\033[0m'
        print(f"  {colour}{status}{reset}  {args[0]}")


def parse_args():
    p = argparse.ArgumentParser(
        description='Liquid Glass PRO — development server',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--port', '-p', type=int, default=8080,
                   help='Port to listen on (default: 8080)')
    p.add_argument('--host', default='localhost',
                   help='Bind address (default: localhost; use 0.0.0.0 for LAN)')
    p.add_argument('--no-open', action='store_true',
                   help='Do not auto-open browser on start')
    p.add_argument('--dir', default=None,
                   help='Directory to serve (default: directory of this script)')
    return p.parse_args()


def main():
    args = parse_args()

    # Change to the project directory so relative imports in demo.html work
    serve_dir = args.dir or os.path.dirname(os.path.abspath(__file__))
    os.chdir(serve_dir)

    url = f'http://{args.host}:{args.port}/demo.html'

    # Bind server
    handler = partial(LGHandler, directory=serve_dir)
    try:
        server = HTTPServer((args.host, args.port), handler)
    except OSError as e:
        print(f'\n  \033[91m✗\033[0m  Cannot bind {args.host}:{args.port} — {e}')
        print(f'       Try: python run.py --port {args.port + 1}')
        sys.exit(1)

    print()
    print('  \033[1m\033[95m◆ Liquid Glass PRO\033[0m  development server')
    print()
    print(f'  \033[92m●\033[0m  Serving:  \033[4m{url}\033[0m')
    print(f'     Root:     {serve_dir}')
    print()
    print('  Notes:')
    print('   • html2canvas requires this server (ES modules + same-origin)')
    print('   • Test on mobile:  python run.py --host 0.0.0.0')
    print('     then open  http://<your-LAN-ip>:{}/demo.html'.format(args.port))
    print()
    print('  Press  Ctrl+C  to stop.')
    print()

    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n\n  \033[93m◆\033[0m  Server stopped.\n')
        server.server_close()
        sys.exit(0)


if __name__ == '__main__':
    main()