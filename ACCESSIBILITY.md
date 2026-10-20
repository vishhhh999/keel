# Accessibility

Keel is used on a phone, outdoors, often in sunlight and on the move, sometimes by a moderator who has never seen the dashboard before. Accessibility is part of reliability: if the streamer cannot read the state at a glance, the product has failed.

## What we commit to

- **State is never colour alone.** Every signal state is a word ("Live.", "Weak signal.", "Holding on."), a colour and a tilt angle of the mark, together. Readable for colour-blind users and in direct sunlight.
- **Contrast.** Text colours are chosen for WCAG 2.1 AA contrast on their backgrounds. The brand orange never carries small text on the light background (it fails AA there); dark text sits on orange instead.
- **Large targets.** Primary controls are at least 50 px tall, Go live and Stop are 64 px, built for thumbs and gloves.
- **Keyboard and screen readers.** Controls are real buttons; switches use `role="switch"` and `aria-checked`; destination toggles are labelled with the platform name.
- **Reduced motion.** The website honours `prefers-reduced-motion`.
- **No audio-only alerts.** Every alert is also text: on the dashboard, in Twitch chat and in Discord or Slack.

## Supported environments

- Dashboard and website: current Chrome, Edge, Firefox and Safari, desktop and mobile, from 360 px wide.
- Mobile app: iOS and Android through Expo (not yet tested on devices).

## Known limitations

- The signal and round trip charts are drawn on canvas and have no text alternative yet; the same numbers are shown as text in the hero card and the reliability record.
- The dashboard has not had a screen reader audit or testing with assistive technology users.
- The website's simulator on the home page is pointer and keyboard operable but has not been tested with a screen reader.
- Light theme only; no high-contrast or dark theme for the dashboard yet.

## Report a barrier

Open an issue with the **Bug report** template and add the label `accessibility`, or email work@visheshmahendru.com. Say what you were trying to do, what got in the way, and what device and assistive technology you use. Barriers that stop someone from going live or stopping a stream are treated as critical bugs.
