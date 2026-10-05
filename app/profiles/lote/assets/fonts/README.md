# League of the East fonts

The scene headlines ("Be Right Back", "Standings") are set in one of the
league's two headline typefaces. The operator picks which on the Live page,
under Scenes. Their files go in this folder:

| File | Typeface | Notes |
| --- | --- | --- |
| `PinkBlue.ttf` | Pink Blue (Rometheme) | Brush capitals. The league holds the licence. |
| `Zentras.ttf` | Zentras (Alit Design) | Blackletter, set in upper and lower case. The file from the designer's free download is marked "personal use only"; a league broadcast needs the full licence from alitdesign.net. |

Neither file is in this repository (see `.gitignore`): their licences don't
allow passing them on. Before building the LotE installer, copy them here;
`npm run dist` names any that are missing.

Without a file everything still works. A typeface whose file is missing is
left out of the choice, and with neither the headlines use Kanit, which ships
with the app.

`profile.json` lists them under `headlineFonts`; `theme.css` holds each one's
sizes and letter case.
