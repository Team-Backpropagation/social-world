from pathlib import Path
from reportlab.pdfgen import canvas
from pypdf import PdfReader

base = Path(__file__).resolve().parent
target = base.parent / "output" / "pdf" / "EXP-003_5173_UI_발표자료_20260930.pdf"
target.parent.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(target), pagesize=(960, 540), pageCompression=1)
for number in range(1, 7):
    picture = base / f"slide-{number}.png"
    pdf.drawImage(str(picture), 0, 0, width=960, height=540, mask="auto")
    pdf.showPage()
pdf.save()
assert len(PdfReader(str(target)).pages) == 6
print(target)
