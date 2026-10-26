/* ---------- Locate the Bookmarks Toolbar folder ---------- */
async function getToolbarChildren() {
  const tree = await browser.bookmarks.getTree();
  const rootChildren = tree[0].children || [];

  // Preferred: Firefox's stable id for the toolbar folder
  let toolbar = rootChildren.find(n => n.id === "toolbar______");

  // Fallback: match by title (localized installs may differ)
  if (!toolbar) {
    toolbar = rootChildren.find(n => /toolbar/i.test(n.title || ""));
  }
  return toolbar ? (toolbar.children || []).slice() : [];
}

/* ---------- Fetch a favicon and return its dominant hue ---------- */
async function faviconColor(url) {
  try {
    // Safely extract domain
    const domain = new URL(url).hostname;
    
    // Use icon.horse, which provides proper CORS headers for canvas reading
    const faviconUrl = `https://icon.horse/icon/${encodeURIComponent(domain)}`;

    const res  = await fetch(faviconUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const blob = await res.blob();
    const bmp  = await createImageBitmap(blob);

    // icon.horse returns 64x64 images
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    // Saturation-weighted average color, ignoring transparent/white/black noise
    let rS = 0, gS = 0, bS = 0, wS = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (a < 32) continue;
      
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lightness = (mx + mn) / 2;
      
      // Skip near-white and near-black pixels (background noise)
      if (lightness < 20 || lightness > 235) continue; 
      
      const w = sat * (a / 255);
      rS += r * w; gS += g * w; bS += b * w; wS += w;
    }
    
    if (wS < 10) return { hue: -1, wavelength: -1, sat: 0 }; // Achromatic

    const r = rS / wS, g = gS / wS, b = bS / wS;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hue = 0;
    if (mx !== mn) {
      const d = mx - mn;
      switch (mx) {
        case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
        case g: hue = (b - r) / d + 2; break;
        case b: hue = (r - g) / d + 4; break;
      }
      hue *= 60;
    }
    const sat = mx === 0 ? 0 : (mx - mn) / mx;

    // Approximate hue → visible wavelength (nm)
    let wl;
    if (hue <  60) wl = 700 - (hue / 60) * 120;       // Red → Yellow
    else if (hue < 120) wl = 580 - ((hue - 60) / 60) * 60;  // Yellow → Green
    else if (hue < 180) wl = 520 - ((hue - 120) / 60) * 30; // Green → Cyan
    else if (hue < 240) wl = 490 - ((hue - 180) / 60) * 30; // Cyan → Blue
    else if (hue < 300) wl = 460 - ((hue - 240) / 60) * 40; // Blue → Magenta
    else wl = 420 - ((hue - 300) / 60) * 40;          // Magenta → Violet

    return { hue, wavelength: wl, sat };
  } catch (e) {
    console.warn("faviconColor failed for", url, e);
    return { hue: -1, wavelength: -1, sat: 0 };
  }
}

/* ---------- Main sort routine ---------- */
async function sortToolbar() {
  const items = await getToolbarChildren();
  if (items.length === 0) return "Bookmark toolbar is empty.";

  const colored = [];
  for (const it of items) {
    // Folders (no URL) get achromatic values and are pushed to the end
    const c = it.url ? await faviconColor(it.url) : { hue: -1, wavelength: -1, sat: 0 };
    colored.push({ item: it, ...c });
  }

  // Sort: Chromatic colors first (ascending hue = red to violet), achromatic/folders at the end
  colored.sort((a, b) => {
    const aC = a.sat >= 0.15, bC = b.sat >= 0.15;
    if (aC && bC) return a.hue - b.hue;
    if (aC) return -1;
    if (bC) return  1;
    return 0;
  });

  for (let i = 0; i < colored.length; i++) {
    await browser.bookmarks.move(colored[i].item.id, { index: i });
  }
  return `Sorted ${colored.length} toolbar items by wavelength.`;
}

/* ---------- Message handler ---------- */
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.action === "sort") return sortToolbar();
});
