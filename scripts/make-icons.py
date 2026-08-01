"""Genere les icones de la PWA.

Sans icone, « Ajouter a l'ecran d'accueil » sur iOS produit une capture grise
de la page — illisible parmi les autres applications.

Le motif est un livre ouvert : deux pages blanches de part et d'autre d'une
reliure, sur le bleu primaire du theme. Choisi pour rester lisible a 40 px,
la taille reelle d'une icone sur un ecran d'accueil.

    python scripts/make-icons.py

Sorties dans web/public/icons/ :
    apple-touch-icon.png   180  iOS. Pas de transparence : Safari la
                                remplacerait par du noir.
    icon-192.png           192  manifeste
    icon-512.png           512  manifeste, splash screen
    icon-maskable-512.png  512  Android, motif dans la zone sure centrale
    favicon.svg                 onglet de navigateur
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "icons"

BLUE = (37, 99, 235)        # --color-primary, mode clair
BLUE_DEEP = (30, 64, 175)   # --color-primary-pressed, pour la profondeur
WHITE = (255, 255, 255)
PAPER_SHADE = (226, 232, 240)  # --color-surface-pressed

# Rendu 4x puis reduction : Pillow ne sait pas antialiaser les polygones.
SUPERSAMPLE = 4


def draw_icon(size: int, *, padding_ratio: float, rounded: bool) -> Image.Image:
    s = size * SUPERSAMPLE
    img = Image.new("RGB", (s, s), BLUE)
    d = ImageDraw.Draw(img)

    # Degrade vertical discret : un aplat pur parait plat a cote des icones
    # natives d'iOS, qui ont toutes une profondeur.
    for y in range(s):
        t = y / s
        d.line(
            [(0, y), (s, y)],
            fill=(
                int(BLUE[0] + (BLUE_DEEP[0] - BLUE[0]) * t),
                int(BLUE[1] + (BLUE_DEEP[1] - BLUE[1]) * t),
                int(BLUE[2] + (BLUE_DEEP[2] - BLUE[2]) * t),
            ),
        )

    # Zone du motif. `padding_ratio` est plus large pour l'icone maskable :
    # Android recadre dans sa propre forme et rognerait un motif trop etale.
    pad = s * padding_ratio
    box = s - 2 * pad
    cx = s / 2
    top = pad + box * 0.18
    bottom = pad + box * 0.84
    half = box * 0.42
    lift = box * 0.10  # relevement des bords exterieurs : le livre s'ouvre

    # Page gauche
    d.polygon(
        [(cx - box * 0.02, top), (cx - half, top + lift), (cx - half, bottom), (cx - box * 0.02, bottom - lift * 0.5)],
        fill=WHITE,
    )
    # Page droite, legerement grisee pour detacher les deux volets
    d.polygon(
        [(cx + box * 0.02, top), (cx + half, top + lift), (cx + half, bottom), (cx + box * 0.02, bottom - lift * 0.5)],
        fill=PAPER_SHADE,
    )
    # Reliure
    d.rectangle([cx - box * 0.02, top, cx + box * 0.02, bottom - lift * 0.5], fill=BLUE_DEEP)

    # Lignes de texte suggerees sur la page gauche.
    #
    # L'espacement doit tenir dans la hauteur reelle de la page, qui va de
    # `top + lift` a `bottom` sur son bord exterieur, soit 0.56 x box. Un pas
    # trop grand fait deborder la derniere ligne SOUS la page — le motif garde
    # l'air correct en grand et devient une bavure a 40 px.
    line_x0 = cx - half * 0.82
    line_x1 = cx - box * 0.08
    for i in range(4):
        y = top + lift + box * (0.06 + i * 0.12)
        # La derniere ligne est raccourcie : c'est ce qui fait lire « du texte »
        # plutot que « des barres ».
        x1 = line_x1 - (box * 0.10 if i == 3 else 0)
        d.rectangle([line_x0, y, x1, y + box * 0.035], fill=PAPER_SHADE)

    if rounded:
        # Masque a coins arrondis facon iOS (~22 % du cote).
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
        flat = Image.new("RGB", (s, s), WHITE)
        flat.paste(img, mask=mask)
        img = flat

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # iOS applique lui-meme le masque a coins arrondis : fournir une image
    # carree, sinon les coins sont arrondis deux fois.
    draw_icon(180, padding_ratio=0.10, rounded=False).save(OUT / "apple-touch-icon.png")
    draw_icon(192, padding_ratio=0.10, rounded=True).save(OUT / "icon-192.png")
    draw_icon(512, padding_ratio=0.10, rounded=True).save(OUT / "icon-512.png")
    # Maskable : le motif doit tenir dans le cercle central de 80 %.
    draw_icon(512, padding_ratio=0.22, rounded=False).save(OUT / "icon-maskable-512.png")

    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        '  <rect width="64" height="64" rx="14" fill="#2563eb"/>\n'
        '  <path d="M31 16 L14 19 L14 47 L31 44 Z" fill="#ffffff"/>\n'
        '  <path d="M33 16 L50 19 L50 47 L33 44 Z" fill="#e2e8f0"/>\n'
        '  <rect x="30.5" y="16" width="3" height="28" fill="#1e40af"/>\n'
        '</svg>\n',
        encoding="utf-8",
    )

    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:24s} {f.stat().st_size // 1024:4d} Ko")


if __name__ == "__main__":
    main()
