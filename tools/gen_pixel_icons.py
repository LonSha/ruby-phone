#!/usr/bin/env python3
"""生成 phone/icons/*.svg —— RubyPhone 像素图标集（v4.92.0）。

纪律（pixel-engine.lintPixelSvg 的机器判据同源）：
  · 24×24 视框，所有坐标/宽高整数；
  · 只用 <rect>/<path>，禁 <circle>/平滑曲线（圆用 rect 阶梯拼）；
  · shape-rendering="crispEdges"；色只取 16 色盘。
每个图标 = 「底色方块(pxbox 感) + 黑色描边图形」。聚合壳单独由 pixel-engine 的
folderMiniSwatches 拼，不在此处生成（它们需要运行时类目成员色）。
"""
import os

PAL = {
    'black': '#1a1c2c', 'dkblue': '#333c57', 'blue': '#5d7fa6', 'ltblue': '#8fd3ff',
    'white': '#f4f4f4', 'cream': '#ffedd0', 'red': '#d93744', 'pink': '#f77b8f',
    'orange': '#f9a03f', 'yellow': '#f9e14e', 'green': '#3fae49', 'ltgreen': '#9de64e',
    'dkgreen': '#27613b', 'brown': '#8a5636', 'dkbrown': '#5a3d28', 'gray': '#7d8590'
}

def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
            'shape-rendering="crispEdges">' + body + '</svg>')

def base(bg):
    return f'<rect x="1" y="1" width="22" height="22" fill="{bg}" stroke="{PAL["black"]}" stroke-width="2"/>'

# 每个图标：(底色, 内部图形片段)
ICONS = {
    'wechat': (PAL['green'],
        '<rect x="4" y="6" width="16" height="10" fill="#f4f4f4"/>'
        '<rect x="4" y="6" width="16" height="2" fill="#27613b"/>'
        '<rect x="8" y="16" width="4" height="4" fill="#f4f4f4"/>'
        '<rect x="8" y="9" width="2" height="2" fill="#1a1c2c"/>'
        '<rect x="14" y="9" width="2" height="2" fill="#1a1c2c"/>'),
    'honey': (PAL['pink'],
        '<rect x="6" y="8" width="4" height="4" fill="#f4f4f4"/>'
        '<rect x="14" y="8" width="4" height="4" fill="#f4f4f4"/>'
        '<rect x="5" y="10" width="14" height="6" fill="#f4f4f4"/>'
        '<rect x="10" y="16" width="4" height="2" fill="#d93744"/>'),
    'phone': (PAL['ltgreen'],
        '<rect x="8" y="4" width="8" height="16" fill="#1a1c2c"/>'
        '<rect x="10" y="6" width="4" height="8" fill="#8fd3ff"/>'
        '<rect x="10" y="16" width="4" height="2" fill="#f9e14e"/>'),
    'diary': (PAL['yellow'],
        '<rect x="6" y="4" width="13" height="16" fill="#ffedd0" stroke="#1a1c2c" stroke-width="2"/>'
        '<rect x="8" y="7" width="9" height="2" fill="#1a1c2c"/>'
        '<rect x="8" y="11" width="9" height="2" fill="#1a1c2c"/>'
        '<rect x="8" y="15" width="6" height="2" fill="#1a1c2c"/>'),
    'album': (PAL['ltblue'],
        '<rect x="4" y="5" width="16" height="14" fill="#f4f4f4" stroke="#1a1c2c" stroke-width="2"/>'
        '<rect x="6" y="7" width="5" height="5" fill="#8fd3ff"/>'
        '<rect x="6" y="14" width="12" height="3" fill="#3fae49"/>'
        '<rect x="13" y="8" width="4" height="4" fill="#f9e14e"/>'),
    'calendar': (PAL['orange'],
        '<rect x="4" y="5" width="16" height="15" fill="#ffedd0" stroke="#1a1c2c" stroke-width="2"/>'
        '<rect x="4" y="5" width="16" height="4" fill="#d93744"/>'
        '<rect x="7" y="12" width="2" height="2" fill="#1a1c2c"/>'
        '<rect x="11" y="12" width="2" height="2" fill="#1a1c2c"/>'
        '<rect x="15" y="12" width="2" height="2" fill="#1a1c2c"/>'
        '<rect x="7" y="16" width="2" height="2" fill="#1a1c2c"/>'
        '<rect x="11" y="16" width="2" height="2" fill="#1a1c2c"/>'),
    'games': (PAL['red'],
        '<rect x="3" y="9" width="18" height="7" fill="#1a1c2c"/>'
        '<rect x="5" y="11" width="3" height="3" fill="#f4f4f4"/>'
        '<rect x="6" y="10" width="1" height="5" fill="#f4f4f4"/>'
        '<rect x="16" y="10" width="2" height="2" fill="#f9e14e"/>'
        '<rect x="18" y="12" width="2" height="2" fill="#8fd3ff"/>'),
    'settings': (PAL['gray'],
        '<rect x="10" y="3" width="4" height="4" fill="#1a1c2c"/>'
        '<rect x="10" y="17" width="4" height="4" fill="#1a1c2c"/>'
        '<rect x="3" y="10" width="4" height="4" fill="#1a1c2c"/>'
        '<rect x="17" y="10" width="4" height="4" fill="#1a1c2c"/>'
        '<rect x="6" y="6" width="12" height="12" fill="#1a1c2c"/>'
        '<rect x="9" y="9" width="6" height="6" fill="#7d8590"/>'
        '<rect x="11" y="11" width="2" height="2" fill="#f4f4f4"/>'),
    # 聚合壳占位（运行时被 folderMiniSwatches 覆盖，这里给一个可单独存在的像素文件夹）
    '__folder': (PAL['blue'],
        '<rect x="3" y="6" width="7" height="3" fill="#ffedd0" stroke="#1a1c2c" stroke-width="2"/>'
        '<rect x="3" y="7" width="18" height="13" fill="#ffedd0" stroke="#1a1c2c" stroke-width="2"/>'
        '<rect x="7" y="11" width="3" height="3" fill="#f77b8f"/>'
        '<rect x="11" y="11" width="3" height="3" fill="#f9a03f"/>'
        '<rect x="7" y="15" width="3" height="3" fill="#9de64e"/>'
        '<rect x="11" y="15" width="3" height="3" fill="#8fd3ff"/>'),
}

outdir = 'phone/icons'
os.makedirs(outdir, exist_ok=True)
for name, (bg, body) in ICONS.items():
    fname = 'folder.svg' if name == '__folder' else f'{name}.svg'
    with open(os.path.join(outdir, fname), 'w', encoding='utf-8') as f:
        f.write(svg(base(bg) + body))
    print('written', fname)
print('total', len(ICONS))