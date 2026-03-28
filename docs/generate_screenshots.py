"""
Generate mock screenshots for Oikos family planner PWA.
Creates mobile-style mockups matching the app's design system.
"""

from PIL import Image, ImageDraw, ImageFont
import os

# --- Paths ---
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "screenshots")
LOGO_PATH = os.path.join(BASE, "..", "public", "assets", "oikos-icon-1024.png")
os.makedirs(OUT, exist_ok=True)

# --- Fonts ---
FONT_BOLD = "/usr/share/fonts/google-noto/NotoSans-Bold.ttf"
FONT_SEMI = "/usr/share/fonts/google-noto/NotoSans-SemiBold.ttf"
FONT_MED = "/usr/share/fonts/google-noto/NotoSans-Medium.ttf"
FONT_REG = "/usr/share/fonts/google-noto/NotoSans-Regular.ttf"


def font(style="regular", size=14):
    paths = {"bold": FONT_BOLD, "semi": FONT_SEMI, "medium": FONT_MED, "regular": FONT_REG}
    return ImageFont.truetype(paths.get(style, FONT_REG), size)


# --- Design Tokens ---
C = {
    "bg": "#FAFAF8",
    "surface": "#FFFFFF",
    "border": "#E8E7E3",
    "text": "#1C1C1A",
    "text2": "#4A4A46",
    "text3": "#8E8D89",
    "accent": "#2563EB",
    "accent_light": "#EFF6FF",
    "accent_dark": "#1D4ED8",
    "green": "#15803D",
    "green_light": "#DCFCE7",
    "orange": "#B45309",
    "orange_light": "#FFF4D4",
    "red": "#DC2626",
    "red_light": "#FEE2E2",
    "purple": "#8250DF",
    "purple_light": "#F3EEFF",
    "shopping_accent": "#D4511E",
    "shopping_light": "#FFECE3",
    "teal": "#1A7F5A",
    "gold": "#BF8700",
    "white": "#FFFFFF",
    "nav_bg": "#FAFAF8",
}

# Dark theme
CD = {
    "bg": "#1C1C1A",
    "surface": "#2A2A28",
    "border": "#3A3A38",
    "text": "#F5F4F1",
    "text2": "#D1D0CB",
    "text3": "#8E8D89",
    "accent": "#4B8BFF",
    "accent_light": "#1E3A5F",
    "accent_dark": "#6BA1FF",
    "green": "#22C55E",
    "green_light": "#1A3D2A",
    "orange": "#F59E0B",
    "orange_light": "#3D2E0A",
    "red": "#EF4444",
    "red_light": "#3D1A1A",
    "purple": "#A371F7",
    "purple_light": "#2D1F4E",
    "shopping_accent": "#F97316",
    "shopping_light": "#3D2010",
    "teal": "#34D399",
    "gold": "#EAB308",
    "white": "#F5F4F1",
    "nav_bg": "#222220",
}

# Phone dimensions (iPhone-like)
W = 393
H = 852
NAV_H = 56
STATUS_H = 44
CORNER = 40
PAD = 16


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def c(name, dark=False):
    """Get color as RGB tuple."""
    palette = CD if dark else C
    return hex_to_rgb(palette[name])


def new_screen(dark=False):
    """Create a blank phone screen."""
    img = Image.new("RGB", (W, H), c("bg", dark))
    return img, ImageDraw.Draw(img)


def draw_status_bar(draw, dark=False):
    """Draw iOS-style status bar."""
    y = 14
    # Time
    draw.text((24, y), "09:41", fill=c("text", dark), font=font("semi", 15))
    # Signal dots
    for i in range(4):
        x = W - 80 + i * 8
        draw.ellipse([x, y + 4, x + 5, y + 9], fill=c("text", dark))
    # Battery
    draw.rounded_rectangle([W - 36, y + 2, W - 12, y + 12], radius=2,
                           outline=c("text", dark), width=1)
    draw.rectangle([W - 34, y + 4, W - 18, y + 10], fill=c("green", dark))


def draw_bottom_nav(draw, active_idx, dark=False):
    """Draw bottom navigation bar."""
    y = H - NAV_H
    # Background
    draw.rectangle([0, y, W, H], fill=c("nav_bg", dark))
    draw.line([(0, y), (W, y)], fill=c("border", dark), width=1)

    labels = ["Übersicht", "Aufgaben", "Kalender", "Einkauf", "Essen"]
    icons = ["⊞", "☑", "📅", "🛒", "🍽"]
    module_colors_light = [
        c("accent", dark), c("green", dark), c("purple", dark),
        c("shopping_accent", dark), c("orange", dark)
    ]

    tab_w = W // 5
    for i, (label, icon) in enumerate(zip(labels, icons)):
        cx = tab_w * i + tab_w // 2
        color = module_colors_light[i] if i == active_idx else c("text3", dark)

        # Simple icon placeholder (circle with letter)
        draw.ellipse([cx - 10, y + 8, cx + 10, y + 28], fill=color if i == active_idx else None,
                     outline=color, width=2)
        # Active dot
        if i == active_idx:
            draw.ellipse([cx - 2, y + 32, cx + 2, y + 36], fill=color)

        # Label
        bbox = draw.textbbox((0, 0), label, font=font("medium", 10))
        lw = bbox[2] - bbox[0]
        draw.text((cx - lw // 2, y + 38), label, fill=color, font=font("medium", 10))


def draw_card(draw, x, y, w, h, dark=False, radius=12):
    """Draw a card with subtle border."""
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius,
                           fill=c("surface", dark), outline=c("border", dark), width=1)


def draw_pill(draw, x, y, text_str, bg_color, text_color, dark=False, f=None):
    """Draw a pill badge."""
    if f is None:
        f = font("semi", 11)
    bbox = draw.textbbox((0, 0), text_str, font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pw = tw + 14
    ph = th + 6
    draw.rounded_rectangle([x, y, x + pw, y + ph], radius=ph // 2,
                           fill=bg_color)
    draw.text((x + 7, y + 2), text_str, fill=text_color, font=f)
    return pw


def draw_checkbox(draw, x, y, checked=False, dark=False, size=20):
    """Draw a checkbox."""
    if checked:
        draw.rounded_rectangle([x, y, x + size, y + size], radius=4,
                               fill=c("green", dark))
        # Checkmark
        draw.line([(x + 4, y + size // 2), (x + size // 3 + 1, y + size - 5)],
                  fill=c("white"), width=2)
        draw.line([(x + size // 3 + 1, y + size - 5), (x + size - 4, y + 4)],
                  fill=c("white"), width=2)
    else:
        draw.rounded_rectangle([x, y, x + size, y + size], radius=4,
                               outline=c("border", dark), width=2)


# ============================================================
# SCREENSHOT 1: DASHBOARD
# ============================================================
def make_dashboard(dark=False):
    img, draw = new_screen(dark)
    draw_status_bar(draw, dark)

    y = STATUS_H + 8

    # Greeting card (blue gradient)
    grad_top = c("accent_dark", dark)
    grad_bot = c("accent", dark)
    card_h = 100
    draw.rounded_rectangle([PAD, y, W - PAD, y + card_h], radius=16, fill=grad_bot)
    # Gradient effect (top portion darker)
    for i in range(card_h // 3):
        alpha_ratio = 1 - (i / (card_h // 3))
        r = int(grad_top[0] * alpha_ratio + grad_bot[0] * (1 - alpha_ratio))
        g = int(grad_top[1] * alpha_ratio + grad_bot[1] * (1 - alpha_ratio))
        b = int(grad_top[2] * alpha_ratio + grad_bot[2] * (1 - alpha_ratio))
        draw.line([(PAD + 1, y + i), (W - PAD - 1, y + i)], fill=(r, g, b))
    # Round top corners
    draw.rounded_rectangle([PAD, y, W - PAD, y + card_h], radius=16, outline=None)

    draw.text((PAD + 16, y + 16), "Guten Morgen, Lisa 👋", fill=(255, 255, 255),
              font=font("bold", 20))
    draw.text((PAD + 16, y + 44), "Freitag, 28. März 2026", fill=(220, 230, 255),
              font=font("regular", 13))
    # Weather mini
    draw.text((PAD + 16, y + 68), "☀️  17 °C  —  Berlin", fill=(200, 215, 255),
              font=font("medium", 13))

    y += card_h + 16

    # Section: Anstehende Termine
    draw.text((PAD, y), "Anstehende Termine", fill=c("text", dark), font=font("semi", 16))
    y += 26

    events = [
        ("Zahnarzt – Lisa", "10:00 – 11:00", c("red", dark)),
        ("Schulabholung – Max", "15:30", c("accent", dark)),
        ("Sportverein", "18:00 – 19:30", c("purple", dark)),
    ]
    for title, time_str, color in events:
        draw_card(draw, PAD, y, W - PAD * 2, 52, dark)
        draw.rectangle([PAD + 4, y + 8, PAD + 7, y + 44], fill=color)
        draw.text((PAD + 16, y + 10), title, fill=c("text", dark), font=font("medium", 14))
        draw.text((PAD + 16, y + 30), time_str, fill=c("text3", dark), font=font("regular", 12))
        y += 60

    y += 8

    # Section: Dringende Aufgaben
    draw.text((PAD, y), "Dringende Aufgaben", fill=c("text", dark), font=font("semi", 16))
    y += 26

    tasks = [
        ("Steuererklärung einreichen", "Heute", c("red", dark)),
        ("Kühlschrank reparieren", "Morgen", c("orange", dark)),
        ("Schulbuch bestellen", "Fr", c("text3", dark)),
    ]
    for title, due, prio_color in tasks:
        draw_card(draw, PAD, y, W - PAD * 2, 44, dark)
        draw.ellipse([PAD + 12, y + 16, PAD + 19, y + 23], fill=prio_color)
        draw.text((PAD + 28, y + 12), title, fill=c("text", dark), font=font("regular", 13))
        bbox = draw.textbbox((0, 0), due, font=font("regular", 12))
        tw = bbox[2] - bbox[0]
        draw.text((W - PAD - 12 - tw, y + 14), due, fill=c("text3", dark), font=font("regular", 12))
        y += 52

    y += 8

    # Section: Essen heute
    draw.text((PAD, y), "Essen heute", fill=c("text", dark), font=font("semi", 16))
    y += 26

    meals = [
        ("Frühstück", "Haferflocken mit Beeren", c("orange", dark), c("orange_light", dark)),
        ("Mittagessen", "Spaghetti Bolognese", c("green", dark), c("green_light", dark)),
        ("Abendessen", "Gemüsesuppe", c("accent", dark), c("accent_light", dark)),
    ]
    for meal_type, meal_name, color, bg in meals:
        draw_card(draw, PAD, y, W - PAD * 2, 44, dark)
        draw_pill(draw, PAD + 8, y + 12, meal_type, bg, color, dark, font("semi", 10))
        draw.text((PAD + 100, y + 13), meal_name, fill=c("text", dark), font=font("regular", 13))
        y += 52

    draw_bottom_nav(draw, 0, dark)
    return img


# ============================================================
# SCREENSHOT 2: TASKS
# ============================================================
def make_tasks(dark=False):
    img, draw = new_screen(dark)
    draw_status_bar(draw, dark)

    y = STATUS_H + 8

    # Title
    draw.text((PAD, y), "Aufgaben", fill=c("text", dark), font=font("bold", 24))
    y += 40

    # Search bar
    draw.rounded_rectangle([PAD, y, W - PAD, y + 38], radius=10,
                           fill=c("surface", dark), outline=c("border", dark), width=1)
    draw.text((PAD + 14, y + 10), "🔍  Aufgaben suchen...", fill=c("text3", dark),
              font=font("regular", 13))
    y += 50

    # Filter pills
    pill_x = PAD
    for label, active in [("Alle", True), ("Offen", False), ("Heute", False), ("Meine", False)]:
        if active:
            bg, fg = c("accent", dark), (255, 255, 255)
        else:
            bg, fg = c("surface", dark), c("text2", dark)
        pw = draw_pill(draw, pill_x, y, label, bg, fg, dark, font("medium", 12))
        # Border for inactive
        if not active:
            bbox2 = draw.textbbox((0, 0), label, font=font("medium", 12))
            tw = bbox2[2] - bbox2[0]
            draw.rounded_rectangle([pill_x, y, pill_x + tw + 14, y + bbox2[3] - bbox2[1] + 6],
                                   radius=10, outline=c("border", dark), width=1)
        pill_x += pw + 8
    y += 36

    # Task groups
    groups = [
        ("🔴 Dringend", [
            ("Steuererklärung einreichen", "Heute", c("red", dark), False, "L"),
        ]),
        ("🟠 Hoch", [
            ("Kühlschrank reparieren", "Morgen", c("orange", dark), False, "L"),
            ("Arzttermin vereinbaren", "Fr, 28.03.", c("orange", dark), False, "M"),
        ]),
        ("🔵 Normal", [
            ("Schulbuch bestellen", "Fr, 28.03.", c("accent", dark), True, "L"),
            ("Garage aufräumen", "Sa, 29.03.", c("accent", dark), False, "T"),
            ("Geburtstagsgeschenk kaufen", "So, 30.03.", c("accent", dark), False, "L"),
        ]),
    ]

    for group_title, items in groups:
        draw.text((PAD, y), group_title, fill=c("text2", dark), font=font("semi", 13))
        y += 24
        for title, due, prio_color, done, avatar_letter in items:
            draw_card(draw, PAD, y, W - PAD * 2, 52, dark)
            # Checkbox
            draw_checkbox(draw, PAD + 12, y + 16, checked=done, dark=dark)
            # Title
            title_color = c("text3", dark) if done else c("text", dark)
            draw.text((PAD + 40, y + 10), title, fill=title_color, font=font("regular", 14))
            if done:
                # Strikethrough
                bbox2 = draw.textbbox((PAD + 40, y + 10), title, font=font("regular", 14))
                mid_y = (bbox2[1] + bbox2[3]) // 2
                draw.line([(bbox2[0], mid_y), (bbox2[2], mid_y)], fill=c("text3", dark), width=1)
            draw.text((PAD + 40, y + 30), due, fill=c("text3", dark), font=font("regular", 11))

            # Avatar circle
            avatar_colors = {"L": c("accent", dark), "M": c("green", dark), "T": c("orange", dark)}
            ac = avatar_colors.get(avatar_letter, c("accent", dark))
            ax = W - PAD - 32
            draw.ellipse([ax, y + 14, ax + 24, y + 38], fill=ac)
            bbox_a = draw.textbbox((0, 0), avatar_letter, font=font("semi", 12))
            aw = bbox_a[2] - bbox_a[0]
            draw.text((ax + 12 - aw // 2, y + 18), avatar_letter,
                      fill=(255, 255, 255), font=font("semi", 12))

            y += 60
        y += 4

    draw_bottom_nav(draw, 1, dark)
    return img


# ============================================================
# SCREENSHOT 3: CALENDAR
# ============================================================
def make_calendar(dark=False):
    img, draw = new_screen(dark)
    draw_status_bar(draw, dark)

    y = STATUS_H + 8

    # Title + navigation
    draw.text((PAD, y), "März 2026", fill=c("text", dark), font=font("bold", 24))
    # Nav arrows
    draw.text((W - PAD - 50, y + 4), "◀  ▶", fill=c("accent", dark), font=font("regular", 18))
    y += 40

    # View toggle pills
    pill_x = PAD
    for label, active in [("Monat", True), ("Woche", False), ("Tag", False), ("Agenda", False)]:
        if active:
            bg, fg = c("accent", dark), (255, 255, 255)
        else:
            bg, fg = c("surface", dark), c("text2", dark)
        pw = draw_pill(draw, pill_x, y, label, bg, fg, dark, font("medium", 11))
        if not active:
            bbox2 = draw.textbbox((0, 0), label, font=font("medium", 11))
            tw = bbox2[2] - bbox2[0]
            draw.rounded_rectangle([pill_x, y, pill_x + tw + 14, y + bbox2[3] - bbox2[1] + 6],
                                   radius=9, outline=c("border", dark), width=1)
        pill_x += pw + 6
    y += 36

    # Calendar grid
    cell_w = (W - PAD * 2) // 7
    cell_h = 58

    # Day headers
    days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    for i, day in enumerate(days):
        dx = PAD + i * cell_w
        color = c("red", dark) if i >= 5 else c("text3", dark)
        bbox2 = draw.textbbox((0, 0), day, font=font("semi", 12))
        dw = bbox2[2] - bbox2[0]
        draw.text((dx + cell_w // 2 - dw // 2, y), day, fill=color, font=font("semi", 12))
    y += 24

    # Calendar days (March 2026: starts on Sunday)
    # Week 1: - - - - - - 1
    # Week 2: 2-8, Week 3: 9-15, Week 4: 16-22, Week 5: 23-29, Week 6: 30-31
    month_data = [
        [0, 0, 0, 0, 0, 0, 1],
        [2, 3, 4, 5, 6, 7, 8],
        [9, 10, 11, 12, 13, 14, 15],
        [16, 17, 18, 19, 20, 21, 22],
        [23, 24, 25, 26, 27, 28, 29],
        [30, 31, 0, 0, 0, 0, 0],
    ]
    today = 28
    event_days = {3: c("red", dark), 7: c("green", dark), 12: c("purple", dark),
                  18: c("accent", dark), 25: c("orange", dark), 28: c("accent", dark)}

    for week in month_data:
        for i, day_num in enumerate(week):
            dx = PAD + i * cell_w
            if day_num == 0:
                continue
            day_str = str(day_num)
            bbox2 = draw.textbbox((0, 0), day_str, font=font("regular", 14))
            dw = bbox2[2] - bbox2[0]
            cx = dx + cell_w // 2
            cy = y + 10

            if day_num == today:
                draw.ellipse([cx - 16, cy - 4, cx + 16, cy + 24], fill=c("accent", dark))
                draw.text((cx - dw // 2, cy), day_str, fill=(255, 255, 255), font=font("bold", 14))
            else:
                color = c("text3", dark) if i >= 5 else c("text", dark)
                draw.text((cx - dw // 2, cy), day_str, fill=color, font=font("regular", 14))

            # Event dot
            if day_num in event_days and day_num != today:
                draw.ellipse([cx - 3, cy + 24, cx + 3, cy + 30], fill=event_days[day_num])
        y += cell_h

    y += 8

    # Today's events
    draw.text((PAD, y), "Heute — 28. März", fill=c("text", dark), font=font("semi", 16))
    y += 28

    events = [
        ("Zahnarzt – Lisa", "10:00 – 11:00", c("red", dark)),
        ("Schulabholung – Max", "15:30", c("accent", dark)),
        ("Sportverein", "18:00 – 19:30", c("purple", dark)),
    ]
    for title, time_str, color in events:
        draw_card(draw, PAD, y, W - PAD * 2, 52, dark)
        draw.rectangle([PAD + 4, y + 8, PAD + 7, y + 44], fill=color)
        draw.text((PAD + 16, y + 10), title, fill=c("text", dark), font=font("medium", 14))
        draw.text((PAD + 16, y + 30), time_str, fill=c("text3", dark), font=font("regular", 12))
        y += 60

    draw_bottom_nav(draw, 2, dark)
    return img


# ============================================================
# SCREENSHOT 4: SHOPPING
# ============================================================
def make_shopping(dark=False):
    img, draw = new_screen(dark)
    draw_status_bar(draw, dark)

    y = STATUS_H + 8

    # Title
    draw.text((PAD, y), "Einkauf", fill=c("text", dark), font=font("bold", 24))
    y += 40

    # Store tabs
    tabs = [("REWE", True), ("dm", False), ("Baumarkt", False)]
    tab_x = PAD
    for label, active in tabs:
        f_tab = font("semi", 13)
        bbox2 = draw.textbbox((0, 0), label, font=f_tab)
        tw = bbox2[2] - bbox2[0]
        pw = tw + 20
        ph = 30
        if active:
            draw.rounded_rectangle([tab_x, y, tab_x + pw, y + ph], radius=8,
                                   fill=c("green", dark))
            draw.text((tab_x + 10, y + 6), label, fill=(255, 255, 255), font=f_tab)
        else:
            draw.rounded_rectangle([tab_x, y, tab_x + pw, y + ph], radius=8,
                                   outline=c("border", dark), width=1)
            draw.text((tab_x + 10, y + 6), label, fill=c("text2", dark), font=f_tab)
        tab_x += pw + 8
    y += 42

    # Progress
    draw.text((PAD, y), "7 von 14 Artikeln erledigt", fill=c("text3", dark), font=font("regular", 12))
    y += 20
    # Progress bar
    bar_w = W - PAD * 2
    draw.rounded_rectangle([PAD, y, PAD + bar_w, y + 4], radius=2, fill=c("border", dark))
    draw.rounded_rectangle([PAD, y, PAD + bar_w // 2, y + 4], radius=2, fill=c("green", dark))
    y += 16

    # Shopping list by category
    categories = [
        ("Obst & Gemüse", [
            ("Äpfel", "1 kg", True),
            ("Bananen", "6 Stück", False),
            ("Tomaten", "500 g", True),
            ("Salat", "1 Kopf", False),
        ]),
        ("Milchprodukte", [
            ("Milch", "2 L", False),
            ("Butter", "250 g", False),
            ("Joghurt", "400 g", True),
        ]),
        ("Backwaren", [
            ("Brot", "1 Laib", True),
            ("Brötchen", "6 Stück", False),
        ]),
        ("Getränke", [
            ("Mineralwasser", "6er Pack", True),
            ("Apfelsaft", "1 L", True),
        ]),
    ]

    for cat_name, items in categories:
        draw.text((PAD, y), cat_name, fill=c("text3", dark), font=font("semi", 11))
        y += 22
        for name, qty, checked in items:
            draw_card(draw, PAD, y, W - PAD * 2, 40, dark)
            draw_checkbox(draw, PAD + 10, y + 10, checked=checked, dark=dark)
            name_color = c("text3", dark) if checked else c("text", dark)
            draw.text((PAD + 38, y + 11), name, fill=name_color, font=font("regular", 13))
            if checked:
                bbox2 = draw.textbbox((PAD + 38, y + 11), name, font=font("regular", 13))
                mid = (bbox2[1] + bbox2[3]) // 2
                draw.line([(bbox2[0], mid), (bbox2[2], mid)], fill=c("text3", dark), width=1)
            # Quantity right-aligned
            bbox_q = draw.textbbox((0, 0), qty, font=font("regular", 12))
            qw = bbox_q[2] - bbox_q[0]
            draw.text((W - PAD - 12 - qw, y + 12), qty, fill=c("text3", dark),
                      font=font("regular", 12))
            y += 46
        y += 4

    draw_bottom_nav(draw, 3, dark)
    return img


# ============================================================
# SCREENSHOT 5: MEALS
# ============================================================
def make_meals(dark=False):
    img, draw = new_screen(dark)
    draw_status_bar(draw, dark)

    y = STATUS_H + 8

    # Title
    draw.text((PAD, y), "Essensplan", fill=c("text", dark), font=font("bold", 24))
    y += 32
    draw.text((PAD, y), "KW 13 — 23.–29. März 2026", fill=c("text3", dark),
              font=font("regular", 13))
    y += 28

    # Day tabs (horizontal)
    days_short = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    day_nums = [23, 24, 25, 26, 27, 28, 29]
    active_day = 5  # Friday 28.
    tab_w = (W - PAD * 2) // 7
    for i, (ds, dn) in enumerate(zip(days_short, day_nums)):
        cx = PAD + i * tab_w + tab_w // 2
        if i == active_day:
            draw.ellipse([cx - 18, y, cx + 18, y + 36], fill=c("accent", dark))
            draw.text((cx - 6, y + 2), ds, fill=(255, 255, 255), font=font("semi", 11))
            draw.text((cx - 6, y + 18), str(dn), fill=(255, 255, 255), font=font("bold", 12))
        else:
            draw.text((cx - 6, y + 2), ds, fill=c("text3", dark), font=font("regular", 11))
            draw.text((cx - 6, y + 18), str(dn), fill=c("text", dark), font=font("medium", 12))
    y += 48

    # Today's meals
    draw.text((PAD, y), "Freitag, 28. März", fill=c("text", dark), font=font("semi", 16))
    y += 28

    meal_slots = [
        ("Frühstück", "Haferflocken mit Beeren",
         ["Haferflocken: 80 g", "Milch: 200 ml"],
         c("orange", dark), c("orange_light", dark)),
        ("Mittagessen", "Spaghetti Bolognese",
         ["Spaghetti: 200 g", "Hackfleisch: 300 g"],
         c("green", dark), c("green_light", dark)),
        ("Abendessen", "Gemüsesuppe",
         ["Karotten: 200 g", "Kartoffeln: 300 g"],
         c("accent", dark), c("accent_light", dark)),
    ]

    for meal_type, title, ingredients, color, bg_color in meal_slots:
        card_h = 110
        draw_card(draw, PAD, y, W - PAD * 2, card_h, dark)

        # Meal type pill
        draw_pill(draw, PAD + 12, y + 12, meal_type, bg_color, color, dark, font("semi", 11))

        # "Einkaufsliste" link
        bbox_link = draw.textbbox((0, 0), "+ Einkaufsliste", font=font("medium", 11))
        lw = bbox_link[2] - bbox_link[0]
        draw.text((W - PAD - 12 - lw, y + 14), "+ Einkaufsliste",
                  fill=c("accent", dark), font=font("medium", 11))

        # Title
        draw.text((PAD + 12, y + 38), title, fill=c("text", dark), font=font("semi", 15))

        # Ingredients
        iy = y + 60
        for ing in ingredients:
            draw.text((PAD + 16, iy), "•  " + ing, fill=c("text3", dark), font=font("regular", 12))
            iy += 20

        y += card_h + 12

    draw_bottom_nav(draw, 4, dark)
    return img


# ============================================================
# PHONE FRAME
# ============================================================
def add_phone_frame(screen_img, dark=False):
    """Wrap screenshot in a phone bezel."""
    bezel = 12
    frame_w = W + bezel * 2
    frame_h = H + bezel * 2
    frame_color = (30, 30, 30) if not dark else (60, 60, 58)

    frame = Image.new("RGBA", (frame_w + 8, frame_h + 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)

    # Shadow
    draw.rounded_rectangle([4, 6, frame_w + 4, frame_h + 6], radius=CORNER + bezel,
                           fill=(0, 0, 0, 40))

    # Bezel
    draw.rounded_rectangle([0, 0, frame_w, frame_h], radius=CORNER + bezel, fill=frame_color)

    # Screen area
    draw.rounded_rectangle([bezel, bezel, bezel + W, bezel + H], radius=CORNER, fill=(255, 255, 255))

    # Paste screen
    screen_rgba = screen_img.convert("RGBA")
    # Mask with rounded corners
    mask = Image.new("L", (W, H), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, W, H], radius=CORNER, fill=255)
    frame.paste(screen_rgba, (bezel, bezel), mask)

    # Dynamic island
    island_w = 100
    island_h = 28
    ix = frame_w // 2 - island_w // 2
    iy = bezel + 6
    draw.rounded_rectangle([ix, iy, ix + island_w, iy + island_h],
                           radius=island_h // 2, fill=(0, 0, 0))

    return frame


# ============================================================
# SHOWCASE IMAGE
# ============================================================
def make_showcase(screens, dark=False):
    """Create a showcase image with all framed screenshots in a row."""
    framed = [add_phone_frame(s, dark) for s in screens]

    gap = 32
    pad = 80
    total_w = sum(f.width for f in framed) + gap * (len(framed) - 1) + pad * 2

    # Header space
    header_h = 100
    total_h = header_h + max(f.height for f in framed) + pad

    bg = (28, 28, 26) if dark else (248, 250, 248)
    canvas = Image.new("RGBA", (total_w, total_h), bg)
    draw = ImageDraw.Draw(canvas)

    # Header: logo + text
    try:
        logo = Image.open(LOGO_PATH).convert("RGBA")
        logo = logo.resize((64, 64), Image.LANCZOS)
        logo_x = total_w // 2 - 160
        logo_y = pad // 2
        canvas.paste(logo, (logo_x, logo_y), logo)

        text_x = logo_x + 76
        title_color = (245, 244, 241) if dark else (28, 28, 26)
        sub_color = (142, 141, 137) if dark else (74, 74, 70)
        draw.text((text_x, logo_y + 4), "Oikos", fill=title_color, font=font("bold", 36))
        draw.text((text_x, logo_y + 42), "Dein Familienplaner für Zuhause",
                  fill=sub_color, font=font("regular", 16))
    except Exception:
        pass

    # Place framed screenshots
    x = pad
    y = header_h
    for f in framed:
        canvas.paste(f, (x, y), f)
        x += f.width + gap

    return canvas


# ============================================================
# MAIN
# ============================================================
def main():
    generators = [
        ("dashboard", make_dashboard),
        ("tasks", make_tasks),
        ("calendar", make_calendar),
        ("shopping", make_shopping),
        ("meals", make_meals),
    ]

    for theme_name, dark in [("light", False), ("dark", True)]:
        screens = []
        for name, gen_fn in generators:
            screen = gen_fn(dark)
            suffix = "-dark" if dark else ""
            path = os.path.join(OUT, f"{name}{suffix}.png")
            screen.save(path, "PNG")
            print(f"  ✓ {path}")
            screens.append(screen)

        showcase = make_showcase(screens, dark)
        suffix = "-dark" if dark else ""
        showcase_path = os.path.join(OUT, f"showcase{suffix}.png")
        showcase.save(showcase_path, "PNG")
        print(f"  ✓ {showcase_path} ({showcase.width}x{showcase.height})")

    print("\nFertig! Alle Screenshots und Showcase-Bilder generiert.")


if __name__ == "__main__":
    main()
