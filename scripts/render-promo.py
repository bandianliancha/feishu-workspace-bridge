#!/usr/bin/env python3
"""Render the repository's privacy-safe promotional artwork.

Requires Pillow. The generated artwork only uses placeholder credentials and
synthetic messages, so it can be published without exposing a real workspace.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
WIDTH, HEIGHT = 1200, 675

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"

BG = "#F5F7FB"
INK = "#111827"
MUTED = "#64748B"
LINE = "#DDE3EC"
BLUE = "#3370FF"
BLUE_SOFT = "#EAF0FF"
GREEN = "#12A594"
GREEN_SOFT = "#E7F8F4"
AMBER = "#F59E0B"
WHITE = "#FFFFFF"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def rounded(draw, box, radius=24, fill=WHITE, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def pill(draw, xy, label, fill, color, pad_x=16, height=34, size=17):
    x, y = xy
    f = font(size, bold=True)
    text_box = draw.textbbox((0, 0), label, font=f)
    w = text_box[2] - text_box[0] + pad_x * 2
    rounded(draw, (x, y, x + w, y + height), height // 2, fill=fill)
    draw.text((x + pad_x, y + (height - size) / 2 - 2), label, font=f, fill=color)
    return w


def header(draw, step, subtitle):
    draw.text((58, 38), "Feishu Workspace Bridge", font=font(30, True), fill=INK)
    x = 58
    x += pill(draw, (x, 88), "DSH 插件", BLUE_SOFT, BLUE) + 10
    x += pill(draw, (x, 88), "实时双向同步", GREEN_SOFT, GREEN) + 10
    pill(draw, (x, 88), "私有群", "#F1F5F9", "#475569")
    draw.text((58, 144), subtitle, font=font(23), fill=MUTED)
    draw.text((1084, 43), f"0{step} / 04", font=font(18, True), fill=MUTED)
    draw.line((58, 187, 1142, 187), fill=LINE, width=2)


def footer(draw, active):
    labels = ["绑定", "按需建群", "双向同步", "可靠交付"]
    xs = [395, 505, 650, 795]
    for i, (x, label) in enumerate(zip(xs, labels), 1):
        color = BLUE if i == active else "#CBD5E1"
        draw.ellipse((x, 625, x + 10, 635), fill=color)
        draw.text((x + 17, 617), label, font=font(15, i == active), fill=color)


def frame_one():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, 1, "只需一次绑定：保存时验证机器人、事件订阅和全部必需权限")

    rounded(d, (58, 220, 760, 585), fill=WHITE, outline=LINE, width=2)
    d.text((88, 248), "绑定飞书自建应用", font=font(26, True), fill=INK)
    fields = [("App ID", "cli_xxxxxxxxxxxxxxxx"), ("App Secret", "••••••••••••••••••••"), ("你的 Open ID", "ou_xxxxxxxxxxxxxxxxxx")]
    y = 305
    for label, value in fields:
        d.text((90, y), label, font=font(17, True), fill="#334155")
        rounded(d, (235, y - 11, 720, y + 35), radius=12, fill="#F8FAFC", outline=LINE)
        d.text((254, y - 1), value, font=font(17), fill="#475569")
        y += 70
    rounded(d, (520, 521, 720, 562), radius=12, fill=INK)
    d.text((566, 530), "保存并验证", font=font(18, True), fill=WHITE)

    rounded(d, (790, 220, 1142, 585), fill="#0F172A")
    d.text((822, 252), "验证通过", font=font(28, True), fill=WHITE)
    checks = ["机器人能力", "长连接事件", "建群与成员权限", "消息与表情权限"]
    y = 320
    for label in checks:
        d.ellipse((824, y, 850, y + 26), fill=GREEN)
        d.text((831, y - 3), "✓", font=font(20, True), fill=WHITE)
        d.text((865, y), label, font=font(19), fill="#E2E8F0")
        y += 58
    footer(d, 1)
    return img


def frame_two():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, 2, "工作区第一次需要同步时才建群，避免产生一堆空群")

    rounded(d, (58, 235, 500, 560), fill="#111827")
    d.text((88, 264), "DSH 工作区", font=font(19, True), fill="#94A3B8")
    d.text((88, 308), "产品发布计划", font=font(30, True), fill=WHITE)
    rounded(d, (88, 380, 456, 478), radius=18, fill="#1F2937")
    d.text((112, 401), "已整理发布清单，共 5 项。", font=font(20), fill="#F8FAFC")
    d.text((112, 438), "下一步先完成演示素材。", font=font(20), fill="#F8FAFC")
    pill(d, (88, 502), "助手回复完成", "#253650", "#93C5FD", size=15)

    d.line((526, 398, 665, 398), fill=BLUE, width=5)
    d.polygon([(665, 398), (644, 384), (644, 412)], fill=BLUE)
    pill(d, (545, 346), "首次同步", BLUE_SOFT, BLUE, size=15)

    rounded(d, (698, 235, 1142, 560), fill=WHITE, outline=LINE, width=2)
    d.text((730, 264), "飞书私有群", font=font(19, True), fill=BLUE)
    d.text((730, 307), "DSH · 产品发布计划", font=font(28, True), fill=INK)
    rounded(d, (730, 378, 1104, 480), radius=18, fill=BLUE_SOFT)
    d.text((754, 399), "已整理发布清单，共 5 项。", font=font(20), fill=INK)
    d.text((754, 438), "下一步先完成演示素材。", font=font(20), fill=INK)
    d.text((730, 515), "自动邀请你加入 · 工作区改名时同步群名", font=font(16), fill=MUTED)
    footer(d, 2)
    return img


def frame_three():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, 3, "在飞书群里继续发消息，自动进入对应的 DSH 会话队列")

    rounded(d, (58, 235, 500, 560), fill=WHITE, outline=LINE, width=2)
    d.text((88, 265), "飞书群", font=font(19, True), fill=BLUE)
    rounded(d, (88, 330, 418, 415), radius=18, fill=BLUE_SOFT)
    d.text((112, 352), "把安装步骤也补充一下", font=font(21), fill=INK)
    d.text((112, 386), "产品同学 · 10:03", font=font(15), fill=MUTED)
    d.ellipse((388, 397, 426, 435), fill=GREEN_SOFT)
    d.text((398, 400), "✓", font=font(22, True), fill=GREEN)
    d.text((88, 484), "OK 表情表示消息已被接收", font=font(16), fill=MUTED)

    d.line((526, 398, 665, 398), fill=GREEN, width=5)
    d.polygon([(665, 398), (644, 384), (644, 412)], fill=GREEN)
    pill(d, (545, 346), "实时事件", GREEN_SOFT, GREEN, size=15)

    rounded(d, (698, 235, 1142, 560), fill="#111827")
    d.text((730, 265), "DSH 会话", font=font(19, True), fill="#94A3B8")
    d.text((730, 310), "产品发布计划", font=font(28, True), fill=WHITE)
    rounded(d, (730, 378, 1104, 468), radius=18, fill="#1F2937")
    d.text((754, 400), "把安装步骤也补充一下", font=font(21), fill="#F8FAFC")
    d.text((754, 436), "来自飞书 · 已加入队列", font=font(15), fill="#86EFAC")
    pill(d, (730, 500), "任务处理中也不会丢消息", "#253650", "#93C5FD", size=15)
    footer(d, 3)
    return img


def frame_four():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    header(d, 4, "为长期运行设计：持久队列、幂等发送、重启恢复和完整诊断")

    cards = [
        (58, 235, "Markdown", "保留标题、列表、代码块\n长消息自动分段", BLUE, "#EAF0FF"),
        (334, 235, "可靠交付", "失败指数退避重试\n进程重启继续发送", GREEN, GREEN_SOFT),
        (610, 235, "生命周期", "改工作区名同步群名\n删工作区自动解散群", "#7C3AED", "#F2ECFF"),
        (886, 235, "本地安全", "Secret 存系统钥匙串\n诊断不含正文与令牌", AMBER, "#FFF7E6"),
    ]
    for x, y, title, body, color, soft in cards:
        rounded(d, (x, y, x + 256, y + 300), fill=WHITE, outline=LINE, width=2)
        rounded(d, (x + 24, y + 24, x + 72, y + 72), radius=14, fill=soft)
        d.ellipse((x + 39, y + 39, x + 57, y + 57), fill=color)
        d.text((x + 24, y + 98), title, font=font(24, True), fill=INK)
        yy = y + 154
        for line in body.split("\n"):
            d.text((x + 24, yy), line, font=font(17), fill=MUTED)
            yy += 34
        d.line((x + 24, y + 254, x + 232, y + 254), fill=LINE, width=2)
        d.text((x + 24, y + 268), "开源 · MIT", font=font(15, True), fill=color)
    footer(d, 4)
    return img


def crossfade(frames, transition_steps=4):
    result = []
    durations = []
    for index, current in enumerate(frames):
        result.append(current)
        durations.append(1800)
        nxt = frames[(index + 1) % len(frames)]
        for step in range(1, transition_steps + 1):
            result.append(Image.blend(current, nxt, step / (transition_steps + 1)))
            durations.append(70)
    return result, durations


def main():
    OUT.mkdir(exist_ok=True)
    frames = [frame_one(), frame_two(), frame_three(), frame_four()]
    frames[1].save(OUT / "preview.png", optimize=True)
    animation, durations = crossfade(frames)
    animation[0].save(
        OUT / "demo.gif",
        save_all=True,
        append_images=animation[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=True,
    )
    print(f"wrote {OUT / 'preview.png'}")
    print(f"wrote {OUT / 'demo.gif'}")


if __name__ == "__main__":
    main()
