#!/usr/bin/env python3
"""Renders the fictional sample documents (sample/documents.json) to PNG files in public/sample/.

The JSON is the text layer: the page shows the same blocks, and the server checks every
quote of the AI draft against them. Rendering here keeps the image and the text identical.
Run: python3 sample/render-documents.py   (needs playwright with chromium)
"""
import json
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = json.loads((ROOT / "sample" / "documents.json").read_text())
OUT = ROOT / "public" / "sample"
OUT.mkdir(parents=True, exist_ok=True)

STYLE = """
<style>
  body { margin: 0; background: #e9e6df; font-family: Georgia, 'Times New Roman', serif; color: #1f1d1a; }
  .page { width: 850px; height: 1100px; background: #fffdf8; box-sizing: border-box; padding: 84px 92px;
          box-shadow: inset 0 0 120px rgba(120,100,60,0.06); position: relative; }
  .letterhead { font-size: 26px; font-weight: 700; letter-spacing: 0.2px; margin: 0; color: #2b3a4a; }
  .letterhead-sub { font-size: 12.5px; color: #5c5750; margin: 6px 0 0; font-family: Helvetica, Arial, sans-serif; }
  .rule { height: 2px; background: #2b3a4a; margin: 22px 0 38px; opacity: .75; }
  .date { font-size: 15px; margin: 0 0 30px; }
  .meta { font-size: 15px; margin: 0 0 8px; }
  .meta.first { margin-top: 0; }
  .para { font-size: 15.5px; line-height: 1.6; margin: 0 0 20px; }
  .space { height: 14px; }
  .signature { font-size: 15.5px; margin: 34px 0 4px; font-style: italic; }
  .signature-sub { font-size: 13px; color: #5c5750; margin: 0; font-family: Helvetica, Arial, sans-serif; }
  .stamp { position: absolute; right: 92px; top: 84px; border: 2px solid #b8b1a6; color: #8a8378; padding: 6px 10px;
           font-family: Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; transform: rotate(-4deg); }
  .cards { width: 760px; padding: 40px; box-sizing: border-box; background: #e9e6df; }
  .card { width: 680px; height: 428px; border-radius: 22px; box-sizing: border-box; padding: 34px 40px; position: relative;
          font-family: Helvetica, Arial, sans-serif; margin: 0 0 32px; box-shadow: 0 10px 30px rgba(0,0,0,.14); }
  .card.front { background: linear-gradient(135deg, #f7f9fc 0%, #e6eef6 100%); border: 1px solid #cfd8e3; }
  .card.back { background: #f4f4f1; border: 1px solid #d9d9d2; }
  .card-brand { font-size: 30px; font-weight: 700; color: #1d4e89; margin: 0 0 26px; letter-spacing: -0.3px; }
  .card-line { font-size: 19px; margin: 0 0 11px; color: #1f2933; }
  .card-small { position: absolute; left: 40px; right: 40px; bottom: 26px; font-size: 12px; color: #6b7280; }
  .card-label { position: absolute; right: 40px; top: 30px; font-size: 11px; letter-spacing: 2px; color: #7b8794; text-transform: uppercase; }
  .chip { position: absolute; right: 40px; top: 60px; width: 54px; height: 40px; border-radius: 8px;
          background: linear-gradient(135deg, #d9c27a, #b89a3e); opacity: .9; }
</style>
"""


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def letter_html(doc):
    page = doc["pages"][0]
    parts = [STYLE, '<div class="page"><div class="stamp">Sample · Fictional</div>']
    for i, b in enumerate(page["blocks"]):
        style = b["style"]
        parts.append(f'<p class="{style}">{esc(b["text"])}</p>')
        if style == "letterhead-sub":
            parts.append('<div class="rule"></div>')
        if style == "meta" and page["blocks"][i + 1]["style"] != "meta":
            parts.append('<div class="space"></div><div class="space"></div>')
    parts.append("</div>")
    return "".join(parts)


def card_html(doc):
    parts = [STYLE, '<div class="cards">']
    for page in doc["pages"]:
        side = "front" if page["number"] == 1 else "back"
        parts.append(f'<div class="card {side}"><div class="card-label">{esc(page["label"])}</div>')
        if side == "front":
            parts.append('<div class="chip"></div>')
        for b in page["blocks"]:
            parts.append(f'<p class="{b["style"]}">{esc(b["text"])}</p>')
        parts.append("</div>")
    parts.append("</div>")
    return "".join(parts)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(device_scale_factor=1.5)
    page.set_viewport_size({"width": 850, "height": 1100})
    page.set_content(letter_html(DOCS["referral-letter"]))
    page.locator(".page").screenshot(path=str(OUT / "referral-letter.png"))
    page.set_viewport_size({"width": 760, "height": 980})
    page.set_content(card_html(DOCS["insurance-card"]))
    page.locator(".cards").screenshot(path=str(OUT / "insurance-card.png"))
    browser.close()
print("rendered", sorted(x.name for x in OUT.iterdir()))
