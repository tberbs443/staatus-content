# STAATUS Content

A public page that shows the STAATUS content plan: a calendar, the idea library, posted content with real Instagram players (reels play, carousels swipe), and the Athletics list.

It is a plain static site. There is no server and no database. The page reads small data files in `data/`, and each person feeds the page from their own notes.

## How the data gets there

| File | Whose | How it is made |
|---|---|---|
| `data/ideas-teo.js` | Teo | `sync.py` reads Teo's `Brand/Content` notes |
| `data/ideas-conor.js` | Conor | `sync.py` reads Conor's notes folder |
| `data/posts.js` | shared | edited by hand: one line per posted Instagram post |
| `data/seed.js` | shared | starting plan items, loaded only for a browser that has none yet |

Each person writes only their own `ideas-<name>.js`, so nobody overwrites anyone else. The page loads every one and merges them.

## For Conor: feeding it from your notes

1. Ask Teo to add you as a collaborator on the repository, then clone it.
2. Put your idea notes in one folder. A note counts as an idea if it has text, an Instagram link, or tags. Tags live in the note's front matter: `themes`, `micro_themes`, `status`, `location`, `collection`, each a list of `[[links]]`.
3. Run, from the repository folder:

```bash
python3 sync.py --author conor --notes "/path/to/your/notes" --push
```

The site updates about a minute later.

## Adding a posted post

Open `data/posts.js` and add a line at the top of the list:
`['<Instagram shortcode>', '2026-12-10', 'Title', 'Carousel', likes, comments],`
The shortcode is the part after `/p/` in the post's link.

## What is saved where

Plan edits (scheduling an idea, ticking it done) are saved in the viewer's own browser only. They do not sync between people. The shared plan lives in the STAATUS HQ.

## Privacy

Everything in this repository is public. Never put people's details, private links, or keys in `data/`.
