# Premium update — what changed

Copy these files over your project (same paths), then:

    npm install
    npm run build

Open the admin panel with  https://YOUR-SITE/#admin  (the buttons are hidden from customers now).

## Header (src/components/Header.tsx, src/index.css)
- Removed the ring and the hatch pattern.
- New: warm spotlight behind the logo, subtle film grain, thin gold edge line with a slow light sweep.
- Glass language switch with a sliding yellow pill, glass theme button with icon swap animation.
- Tagline with hairlines (Arabic text no longer gets letter-spacing, which broke the joined letters).
- Status pill with live ping dot.
- WhatsApp is the primary yellow button, Call and Map are secondary glass buttons.
- Entrance choreography after the logo draws, gentle scroll depth, animations pause when the header is off screen.
- The logo intro video always plays for every visitor (reduced-motion skip removed per owner request).
- Header CSS animations (gold edge sweep, button shine, spotlight) also ignore the OS reduced-motion setting per owner request; off-screen pausing still applies.

## Motion (motion/react, already in package.json)
- Category chips: sliding yellow pill (layoutId).
- Featured cards and menu items: fade/rise on scroll, section bars grow in.
- Thin gold reading-progress line at the top.
- Cart bar slides in; price and buttons no longer wrap on small phones.

## Cards
- Decorative circles replaced by the pan mark from your logo (public/assets/pan-icon-yellow.png).
- Fixed: price pill was clipped on narrow phones (title now wraps to two lines).

## Footer
- Same gold edge line and grain as the header; logo without blend-mode hack (PNG is already transparent).

## Admin and safety
- Admin gear (header) and "Admin Portal" (footer) hidden from customers; open the panel with #admin.
- Saving from the admin now shows an error if the server rejects it (403/409/network) instead of failing silently,
  and adopts the server copy so the next save has the right version number.

## Build
- package.json: esbuild ^0.25.0 -> ^0.28.0. The old value made a clean `npm install` fail (peer conflict with vite 8),
  which would also break a fresh Cloudflare Pages build. package-lock.json regenerated.
