#!/usr/bin/env python3

import argparse
import re
import subprocess
import time
import signal
import sys
from typing import List, Dict, Optional

class WindowMonitor:
    def __init__(self, pattern: str):
        self.pattern = re.compile(pattern)
        self.previous_windows: List[Dict] = []
        
    def run_command(self, cmd: List[str]) -> Optional[str]:
        """Run a shell command and return its output."""
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            print(f"Error running command {' '.join(cmd)}: {e}", file=sys.stderr)
            return None
        except FileNotFoundError:
            print(f"Command not found: {cmd[0]}", file=sys.stderr)
            return None
    
    def get_window_list(self) -> List[Dict]:
        """Get list of windows using wmctrl -l."""
        output = self.run_command(['wmctrl', '-l'])
        if not output:
            return []
        
        windows = []
        for line in output.strip().split('\n'):
            if not line.strip():
                continue
                
            parts = line.split()
            if len(parts) < 4:
                continue
                
            window_id = parts[0]
            desktop = parts[1]
            # The rest is the window title (may contain spaces)
            title = ' '.join(parts[3:])
            
            windows.append({
                'id': window_id,
                'desktop': desktop,
                'title': title
            })
        
        return windows
    
    def get_active_window_id(self) -> Optional[str]:
        """Get the currently active window ID."""
        output = self.run_command(['xdotool', 'getactivewindow'])
        if not output:
            return None
        
        try:
            # Convert decimal window ID to hex format used by wmctrl
            dec_id = int(output.strip())
            return f"0x{dec_id:08x}"
        except ValueError:
            return None
    
    def get_current_desktop(self) -> str:
        """Get the currently active desktop."""
        output = self.run_command(['wmctrl', '-d'])
        if not output:
            return '0'
        
        lines = output.strip().split('\n')
        for line in lines:
            if '*' in line:
                parts = line.split()
                if parts:
                    return parts[0]
        
        return '0'
    
    def send_notification(self, window_title: str, old_title: str, new_title: str):
        """Send a notification using notify-send."""
        message = f'Title changed:\n"{old_title}" → "{new_title}"'
        try:
            subprocess.run([
                'notify-send',
                f'Window Title Changed: {window_title}',
                message
            ], check=True)
        except subprocess.CalledProcessError as e:
            print(f'Failed to send notification: {e}', file=sys.stderr)
    
    def monitor(self):
        """Main monitoring loop."""
        print(f"Monitoring windows matching pattern: {self.pattern.pattern}")
        
        # Get initial state
        self.previous_windows = self.get_window_list()
        filtered_windows = [w for w in self.previous_windows if self.pattern.search(w['title'])]
        
        print(f"Found {len(filtered_windows)} windows to monitor:")
        for window in filtered_windows:
            print(f"  - {window['title']} (desktop: {window['desktop']})")
        
        # Monitoring loop
        while True:
            time.sleep(2)  # Wait 2 seconds
            
            current_windows = self.get_window_list()
            current_filtered = [w for w in current_windows if self.pattern.search(w['title'])]
            
            # Get active window and desktop info
            active_window_id = self.get_active_window_id()
            current_desktop = self.get_current_desktop()
            
            # Check for changes
            for current_window in current_filtered:
                previous_window = next(
                    (w for w in self.previous_windows if w['id'] == current_window['id']),
                    None
                )
                
                if previous_window and previous_window['title'] != current_window['title']:
                    # Check if this is the active window on current desktop
                    is_active_window = current_window['id'] == active_window_id
                    is_on_current_desktop = current_window['desktop'] == current_desktop
                    
                    if not (is_active_window and is_on_current_desktop):
                        # Window title changed and it's not the active foreground window
                        short_title = current_window['title'].split()[0] if current_window['title'] else 'Unknown'
                        self.send_notification(
                            short_title,
                            previous_window['title'],
                            current_window['title']
                        )
                        print(f'Title changed: "{previous_window["title"]}" → "{current_window["title"]}"')
                    else:
                        print(f'Title changed (suppressed - active window): "{previous_window["title"]}" → "{current_window["title"]}"')
            
            # Check for windows that disappeared
            for previous_window in [w for w in self.previous_windows if self.pattern.search(w['title'])]:
                still_exists = any(w['id'] == previous_window['id'] for w in current_windows)
                if not still_exists:
                    print(f'Window closed: {previous_window["title"]}')
            
            # Check for new windows
            for current_window in current_filtered:
                existed_before = any(w['id'] == current_window['id'] for w in self.previous_windows)
                if not existed_before:
                    print(f'New window detected: {current_window["title"]}')
            
            self.previous_windows = current_windows


def signal_handler(signum, frame):
    """Handle graceful shutdown."""
    print('\nMonitoring stopped.')
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description='Monitor window title changes using wmctrl',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s "Chrome"
  %(prog)s "Firefox"
  %(prog)s ".*terminal.*"
        '''
    )
    
    parser.add_argument(
        'pattern',
        help='Regex pattern to filter windows to monitor'
    )
    
    parser.add_argument(
        '-v', '--version',
        action='version',
        version='%(prog)s 1.0.0'
    )
    
    args = parser.parse_args()
    
    # Validate regex pattern
    try:
        re.compile(args.pattern)
    except re.error as e:
        print(f'Invalid regex pattern: {args.pattern}', file=sys.stderr)
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)
    
    # Set up signal handler for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    
    # Start monitoring
    monitor = WindowMonitor(args.pattern)
    try:
        monitor.monitor()
    except Exception as e:
        print(f'Error in monitoring loop: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()