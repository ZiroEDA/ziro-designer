"""Refill a board with kicad-cli (a wxApp: the advanced config loads, the
cache-friendly fracture runs) into refill/<stem>_cli.kicad_pcb."""
import os, sys, subprocess, shutil
stem = sys.argv[1]
d = os.path.expanduser('~/kicad-oracle/refill')
src = f'{d}/{stem}.kicad_pcb'; dst = f'{d}/{stem}_cli.kicad_pcb'
shutil.copy(src, dst)
if os.path.exists(f'{d}/{stem}.kicad_pro'): shutil.copy(f'{d}/{stem}.kicad_pro', f'{d}/{stem}_cli.kicad_pro')
cfg = os.path.expanduser('~/.config/kicad/10.0/kicad_advanced')
if os.path.exists(cfg): os.remove(cfg)
r = subprocess.run(['kicad-cli', 'pcb', 'drc', '--refill-zones', '--save-board', '-o', '/dev/null', dst], capture_output=True, text=True)
print(r.stdout.strip().split('\n')[-2:], r.returncode)
