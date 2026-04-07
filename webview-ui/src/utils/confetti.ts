interface Particle {
  element: HTMLDivElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export const triggerConfetti = (
  x: number,
  y: number,
  color: string = "#ffffff",
) => {
  // Ultra minimal settings
  const particleCount = 6;
  const particles: Particle[] = [];

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.pointerEvents = "none";
  container.style.zIndex = "9999";
  document.body.appendChild(container);

  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement("div");
    const size = 3; // Uniform small size

    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.backgroundColor = color;
    p.style.position = "absolute";
    p.style.borderRadius = "1px";
    p.style.opacity = "1";

    // Upward Cone: -90deg +/- 30deg
    // -PI/2 is straight up
    const spread = Math.PI / 3; // Slightly narrower spread
    const startAngle = -Math.PI / 2;
    const angle = startAngle + (Math.random() - 0.5) * spread;

    // Reduced speed to prevent "splurging too high"
    const speed = Math.random() * 0.4 + 1.2;

    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    container.appendChild(p);

    particles.push({
      element: p,
      x: x,
      y: y - 4, // Lowered starting position (closer to cursor/button)
      vx,
      vy,
      life: 1.0,
      color,
    });
  }

  const animate = () => {
    let activeParticles = false;

    particles.forEach((p) => {
      if (p.life > 0) {
        activeParticles = true;

        // Update physics
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02; // Minimal gravity
        p.life -= 0.05; // Faster fade out to limit height

        // Uniform movement
        const rotate = Math.atan2(p.vy, p.vx) * (180 / Math.PI);
        p.element.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${rotate}deg)`;
        p.element.style.opacity = p.life.toString();
      } else {
        p.element.style.display = "none";
      }
    });

    if (activeParticles) {
      requestAnimationFrame(animate);
    } else {
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }
  };

  requestAnimationFrame(animate);
};
