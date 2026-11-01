const copyButton = document.getElementById("copy");

copyButton.addEventListener("click", async () => {
  const text = document.getElementById("prompt").textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied!";
  } catch {
    copyButton.textContent = "Select and copy";
  }
  setTimeout(() => (copyButton.textContent = "Copy"), 2000);
});

// Pick a job, see who: show the card for the chosen kind of work.
for (const input of document.querySelectorAll('input[name="job"]')) {
  input.addEventListener("change", () => {
    for (const group of document.querySelectorAll("[data-job]")) {
      group.hidden = group.dataset.job !== input.value;
    }
  });
}

// The hero mark: a dot-matrix delta. One stream comes in, branches off and rejoins,
// and a slow wave of brightness runs through it from left to right.
const lens = document.getElementById("lens");

if (lens) {
  const W = 560, H = 210, MID = 105, STEP = 7;
  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const branch = (xs, xe, rise, y) => (x) => {
    if (x < xs || x > xe) return null;
    const t = x < xs + rise ? smooth((x - xs) / rise) : x > xe - rise ? smooth((xe - x) / rise) : 1;
    return MID + (y - MID) * t;
  };
  const channels = [
    { at: () => MID, half: 22, weight: 1 },
    { at: branch(120, 460, 90, 42), half: 12, weight: 0.8 },
    { at: branch(140, 480, 90, 168), half: 12, weight: 0.8 },
    { at: branch(230, 390, 55, 142), half: 9, weight: 0.65, dashed: true },
  ];

  const dots = [];
  for (let y = STEP / 2; y < H; y += STEP) {
    for (let x = STEP / 2; x < W; x += STEP) {
      const edge = smooth(clamp(Math.min(x, W - x) / 110));
      const oval = clamp(1 - ((x - W / 2) / (W / 2)) ** 2 - ((y - MID) / MID) ** 2);
      let flow = 0;
      for (const c of channels) {
        const cy = c.at(x);
        if (cy === null) continue;
        const slope = ((c.at(x + 1) ?? cy) - (c.at(x - 1) ?? cy)) / 2;
        let v = smooth(clamp(1 - Math.abs(y - cy) / Math.sqrt(1 + slope * slope) / c.half)) * c.weight;
        if (c.dashed && Math.floor(x / 14) % 2) v *= 0.2;
        flow = Math.max(flow, v);
      }
      if (flow * edge > 0.02 || oval > 0.06) dots.push({ x, y, flow: flow * edge, base: oval * 0.24 });
    }
  }

  const ctx = lens.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    const scale = (lens.clientWidth / W) * dpr;
    lens.width = Math.round(W * scale);
    lens.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = getComputedStyle(lens).color;
    for (const d of dots) {
      const wave = still.matches ? 1 : 0.78 + 0.22 * Math.sin(d.x / 34 - time / 380);
      const v = Math.max(d.flow * wave, d.base);
      ctx.globalAlpha = 0.12 + 0.88 * v;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.55 + 2.1 * v, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  let frame = 0, last = 0, visible = true;
  const loop = (now) => {
    frame = 0;
    if (now - last > 33) { draw(now); last = now; }
    if (visible && !still.matches) frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (still.matches) draw(0);
    else if (visible && !frame) frame = requestAnimationFrame(loop);
  };

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); }).observe(lens);
  addEventListener("resize", () => { size(); draw(performance.now()); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => draw(performance.now()));
  still.addEventListener("change", start);
  size();
  draw(0);
}
