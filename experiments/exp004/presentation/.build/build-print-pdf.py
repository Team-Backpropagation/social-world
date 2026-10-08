from pathlib import Path

from pypdf import PdfReader
from reportlab.pdfgen import canvas

root = Path(__file__).resolve().parent
output = root.parent / "output" / "pdf" / "EXP-004_발표용_UI_20260930.pdf"
output.parent.mkdir(parents=True, exist_ok=True)

page_width, page_height = 960, 540
document = canvas.Canvas(str(output), pagesize=(page_width, page_height), pageCompression=1)
document.setTitle("함께, 더 가까이 - EXP-004 발표용 UI")
for number in range(1, 5):
    image = root / f"slide-{number}.png"
    document.drawImage(str(image), 0, 0, width=page_width, height=page_height)
    document.showPage()
document.save()

reader = PdfReader(str(output))
if len(reader.pages) != 4:
    raise RuntimeError(f"Expected 4 PDF pages, found {len(reader.pages)}")
print(output)
