# UI design system

Specification only. No app source, runtime tokens or routes are changed by the brand book.

| Component | Specification |
|---|---|
| Button primary | Ink surface, White label; min height 44 px; 4 px radius; 16 px horizontal padding |
| Button secondary | White surface, Ink label and 1 px Ink border |
| Accent action | Cornflower surface with Ink label; reserve for one emphasized action |
| Hover | Ink primary → #262626; secondary → Grey; accent → #3975ED with Ink text |
| Active | 1 px inset Ink rule; no scaling or movement of text |
| Focus | 2 px Ink outline and 2 px White offset; on Ink use White ring with Ink offset |
| Disabled | Grey surface, Ink at 40%, disabled semantics; no hover effect |
| Input | White surface, Ink label, 1 px #6B6B6B border, 4 px radius, min height 44 px |
| Card | White or Grey, 1 px Grey separator; radius 4 px; no default shadow |
| Floating menu | White, Ink border; only optional shadow 0 4px 16px rgba(5,5,5,.12) |
| Table | 44 px minimum rows; 12/16 px cell padding; labels with units; right-aligned tabular amounts |
| Navigation | Text labels, selected underline + current-page semantics; mobile disclosure button |

## States

Loading reserves dimensions, sets aria-busy and names the task. Never fake progress percentages. Empty states identify what is absent and give one next action. Errors attach to the field or action, preserve valid entries, explain safe retry and use an accessible live announcement. Success is confirmed data, with text and an optional status icon.

Destructive and permanent actions state the exact object and consequence before confirmation. Payout locking must explain permanence; a colour alone is insufficient. Keep one primary action per task. Dialogs trap focus, close accessibly and return focus to their trigger.

Keyboard and screen-reader behavior is part of the component, not a later theme exercise. See ACCESSIBILITY.md and COLORS.md for contrast requirements.
