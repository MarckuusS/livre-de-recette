"""Genere les icones de la PWA a partir du SVG de la marque.

Sans icone, « Ajouter a l'ecran d'accueil » sur iOS produit une capture grise
de la page — illisible parmi les autres applications.

LE DESSIN N'EST PAS ICI. Il vit dans web/public/icons/favicon.svg, et ce
script n'en fait que des rendus. La version precedente redessinait le motif en
Pillow, ce qui obligeait a tenir deux dessins d'accord — le SVG de l'onglet et
le Python des PNG. Ils avaient deja diverge.

    python scripts/make-icons.py

Sorties dans web/public/icons/ :
    apple-touch-icon.png   180  iOS. OPAQUE et sans coins arrondis : Safari
                                remplacerait la transparence par du noir, et
                                applique lui-meme son masque.
    icon-192.png           192  manifeste, coins arrondis, fond transparent
    icon-512.png           512  manifeste, splash screen
    icon-maskable-512.png  512  Android. Le motif est reduit dans la zone sure
                                centrale (40 % du rayon) et le fond deborde :
                                le systeme rogne jusqu'a un cercle.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QRectF
from PySide6.QtGui import QColor, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QApplication

RACINE = Path(__file__).resolve().parent.parent
ICONES = RACINE / "web" / "public" / "icons"
SOURCE = ICONES / "favicon.svg"

# Le socle est un degrade radial olive ; on en prend une valeur intermediaire
# comme fond plein la ou l'arrondi du SVG ne doit pas apparaitre (iOS,
# masquable). Un degrade y serait de toute facon invisible.
FOND = QColor("#616f3f")

# Part de la largeur occupee par le motif sur les rendus sans socle.
# 0,80 pour iOS, qui arrondit legerement ; 0,72 pour Android, dont la zone sure
# est le cercle de 40 % de rayon — un motif plus large s'y ferait rogner.
PART_IOS = 0.80
PART_MASQUABLE = 0.72


def rendu_complet(taille: int) -> QImage:
    """Le SVG entier, socle arrondi compris, sur un fond transparent."""
    img = QImage(taille, taille, QImage.Format_ARGB32)
    img.fill(QColor(0, 0, 0, 0))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    QSvgRenderer(str(SOURCE)).render(p, QRectF(0, 0, taille, taille))
    p.end()
    return img


def rendu_sans_socle(taille: int, part: float) -> QImage:
    """Le motif seul, centre sur un fond plein qui va jusqu'au bord."""
    img = QImage(taille, taille, QImage.Format_RGB32)
    img.fill(FOND)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)

    cote = taille * part
    marge = (taille - cote) / 2
    # `render` avec un identifiant tient compte des bornes de l'element : le
    # groupe « marque » est carre, la mise a l'echelle ne le deforme donc pas.
    QSvgRenderer(str(SOURCE)).render(p, "marque", QRectF(marge, marge, cote, cote))
    p.end()
    return img


def main() -> int:
    if not SOURCE.exists():
        print(f"Introuvable : {SOURCE}", file=sys.stderr)
        return 1

    QApplication([])

    sorties = [
        ("icon-192.png", rendu_complet(192)),
        ("icon-512.png", rendu_complet(512)),
        ("apple-touch-icon.png", rendu_sans_socle(180, PART_IOS)),
        ("icon-maskable-512.png", rendu_sans_socle(512, PART_MASQUABLE)),
    ]
    for nom, img in sorties:
        chemin = ICONES / nom
        if not img.save(str(chemin)):
            print(f"Echec de l'ecriture : {chemin}", file=sys.stderr)
            return 1
        print(f"{nom}  {img.width()}x{img.height()}")

    print(f"\n{len(sorties)} icones rendues depuis {SOURCE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
