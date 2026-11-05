# Logo

The logo is the word **stenmont** set in lowercase in **All Round Gothic**, letter-spaced (tracking 10, which we read as `letter-spacing: 0.1em`; confirm against the final artwork). No symbol is required.

```css
.logo {
  font-family: "All Round Gothic", "Avenir Next", Futura, Onest, sans-serif;
  font-weight: 500;
  text-transform: lowercase;
  letter-spacing: 0.1em;
  color: var(--navy); /* white on dark */
}
```

- Always lowercase, even at the start of a sentence in the logo lockup.
- Clear space around it: the height of the letter "t".
- Minimum size: 16 px tall on screen.
- One colour: navy on light, white on dark, never mint or lime.
- Favicon: the letter "s" in the same face on navy, mint "s" optional for the app icon.

## Licence warning

The All Round Gothic files in `Demo_Fonts/` are demo files from Fontspring and the Neue Haas Grotesk files are trial files. Demo and trial fonts are normally licensed for evaluation only and must not be published on a public site or in a public repository. The font files are therefore excluded from git. Buy the web licences before launch; until then the site falls back to the stack above (the logo falls back to a geometric sans).
