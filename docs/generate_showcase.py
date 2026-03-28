"""Generate a showcase image for Oikos with screenshots in a row."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

# --- Config ---
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
OUTPUT_DIR = os.path.dirname(__file__)

CANVAS_WIDTH = 2400
BG_COLOR = "#F8FAFC"  # Light gray background
ACCENT_COLOR = "#2563EB"  # Blue accent matching the logo
TEXT_COLOR = "#1E293B"  # Dark text
SUBTITLE_COLOR = "#64748B"  # Gray subtitle

SCREENSHOT_ORDER = ["dashboard.png", "tasks.png", "calendar.png", "shopping.png", "meals.png"]
SCREENSHOT_HEIGHT = 700  # Target height for each screenshot
PADDING = 60  # Padding around edges
SCREENSHOT_GAP = 32  # Gap between screenshots
CORNER_RADIUS = 24  # Rounded corners for screenshots
SHADOW_OFFSET = 8
SHADOW_BLUR = 20

APP_NAME = "Oikos"
TAGLINE = "Dein Familienplaner für Zuhause"

# Font paths (Fedora)
FONT_BOLD = "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-Bold.otf"
FONT_REGULAR = "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-Regular.otf"
FONT_FALLBACK_BOLD = "/usr/share/fonts/google-carlito-fonts/Carlito-Bold.ttf"
FONT_FALLBACK_REG = "/usr/share/fonts/google-carlito-fonts/Carlito-Regular.ttf"


def load_font(bold=True, size=48):
    """Load best available font."""
    paths = [FONT_BOLD, FONT_FALLBACK_BOLD] if bold else [FONT_REGULAR, FONT_FALLBACK_REG]
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def add_rounded_corners(img, radius):
    """Add rounded corners to an image."""
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), img.size], radius=radius, fill=255)
    result = img.copy()
    result.putalpha(mask)
    return result


def create_shadow(size, radius, offset=8, blur=20):
    """Create a drop shadow."""
    shadow_size = (size[0] + blur * 4, size[1] + blur * 4)
    shadow = Image.new("RGBA", shadow_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    x_off = blur * 2
    y_off = blur * 2 + offset
    draw.rounded_rectangle(
        [(x_off, y_off), (x_off + size[0], y_off + size[1])],
        radius=radius,
        fill=(0, 0, 0, 50),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    return shadow


def main():
    # Load and resize screenshots
    screenshots = []
    for name in SCREENSHOT_ORDER:
        path = os.path.join(SCREENSHOTS_DIR, name)
        img = Image.open(path).convert("RGBA")
        ratio = SCREENSHOT_HEIGHT / img.height
        new_width = int(img.width * ratio)
        img = img.resize((new_width, SCREENSHOT_HEIGHT), Image.LANCZOS)
        screenshots.append(img)

    # Calculate layout
    total_screenshots_width = sum(s.width for s in screenshots) + SCREENSHOT_GAP * (len(screenshots) - 1)

    # Scale screenshots if they don't fit
    available_width = CANVAS_WIDTH - PADDING * 2
    if total_screenshots_width > available_width:
        scale = available_width / total_screenshots_width
        new_screenshots = []
        for s in screenshots:
            new_w = int(s.width * scale)
            new_h = int(s.height * scale)
            new_screenshots.append(s.resize((new_w, new_h), Image.LANCZOS))
        screenshots = new_screenshots
        total_screenshots_width = sum(s.width for s in screenshots) + SCREENSHOT_GAP * (len(screenshots) - 1)

    screenshot_h = screenshots[0].height

    # Header area: logo + text
    logo_size = 72
    title_font = load_font(bold=True, size=52)
    tagline_font = load_font(bold=False, size=28)

    header_height = max(logo_size, 52 + 28 + 8)  # logo or text stack height
    top_section = PADDING + header_height + 48  # padding + header + gap to screenshots
    canvas_height = top_section + screenshot_h + PADDING + SHADOW_BLUR * 2

    # Create canvas
    canvas = Image.new("RGBA", (CANVAS_WIDTH, canvas_height), BG_COLOR)
    draw = ImageDraw.Draw(canvas)

    # --- Draw subtle gradient accent at top ---
    for y in range(min(6, canvas_height)):
        alpha = int(180 * (1 - y / 6))
        draw.line([(0, y), (CANVAS_WIDTH, y)], fill=(37, 99, 235, alpha))

    # --- Draw logo ---
    logo_path = os.path.join(ASSETS_DIR, "oikos-icon-1024.png")
    logo = Image.open(logo_path).convert("RGBA")
    logo = logo.resize((logo_size, logo_size), Image.LANCZOS)

    # Center header: logo + name + tagline
    title_bbox = draw.textbbox((0, 0), APP_NAME, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    tagline_bbox = draw.textbbox((0, 0), TAGLINE, font=tagline_font)
    tagline_w = tagline_bbox[2] - tagline_bbox[0]

    header_total_w = logo_size + 20 + max(title_w, tagline_w)
    header_x = (CANVAS_WIDTH - header_total_w) // 2
    header_y = PADDING

    canvas.paste(logo, (header_x, header_y), logo)

    text_x = header_x + logo_size + 20
    draw.text((text_x, header_y - 4), APP_NAME, fill=TEXT_COLOR, font=title_font)
    draw.text((text_x, header_y + 48), TAGLINE, fill=SUBTITLE_COLOR, font=tagline_font)

    # --- Draw screenshots ---
    start_x = (CANVAS_WIDTH - total_screenshots_width) // 2
    x = start_x
    y = top_section

    for s in screenshots:
        # Shadow
        shadow = create_shadow(s.size, CORNER_RADIUS, SHADOW_OFFSET, SHADOW_BLUR)
        sx = x - SHADOW_BLUR * 2
        sy = y - SHADOW_BLUR * 2
        canvas.paste(shadow, (sx, sy), shadow)

        # Screenshot with rounded corners
        rounded = add_rounded_corners(s, CORNER_RADIUS)
        canvas.paste(rounded, (x, y), rounded)

        x += s.width + SCREENSHOT_GAP

    # Save
    output_path = os.path.join(OUTPUT_DIR, "showcase.png")
    final = canvas.convert("RGB")
    final.save(output_path, "PNG", optimize=True)
    print(f"Showcase image saved: {output_path}")
    print(f"Size: {CANVAS_WIDTH}x{canvas_height}")


if __name__ == "__main__":
    main()
