// ─── NAV SCROLL ───
const nav = document.querySelector('nav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  });
}

// ─── HAMBURGER ───
const hamburger = document.querySelector('.hamburger');
const mobileMenu = document.querySelector('.mobile-menu');
if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open');
    document.body.style.overflow = mobileMenu.classList.contains('open') ? 'hidden' : '';
  });
  mobileMenu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}

// ─── SCROLL REVEAL ───
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });
reveals.forEach(el => observer.observe(el));

// ─── STAR FIELD ───
function createStars(container, count = 60) {
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      --dur: ${3 + Math.random() * 5}s;
      --delay: ${Math.random() * 5}s;
      width: ${Math.random() > 0.8 ? 2 : 1}px;
      height: ${Math.random() > 0.8 ? 2 : 1}px;
    `;
    container.appendChild(star);
  }
}
document.querySelectorAll('.starfield').forEach(sf => createStars(sf));

// ─── WAITLIST COUNT (simulated) ───
function animateCount(el, target, duration = 1500) {
  if (!el) return;
  const start = performance.now();
  const from = Math.max(0, target - Math.floor(Math.random() * 80 + 20));
  function update(ts) {
    const progress = Math.min((ts - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(from + (target - from) * ease).toLocaleString('fr-FR');
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ─── SMOOTH PARALLAX ───
function initParallax() {
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (!parallaxEls.length) return;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    parallaxEls.forEach(el => {
      const speed = parseFloat(el.dataset.parallax) || 0.3;
      el.style.transform = `translateY(${scrollY * speed}px)`;
    });
  }, { passive: true });
}
initParallax();

// ─── TYPEWRITER ───
function typewriter(el, text, speed = 40) {
  if (!el) return;
  el.textContent = '';
  let i = 0;
  const timer = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) clearInterval(timer);
  }, speed);
}

// ─── FORM: WAITLIST ───
function initWaitlistForm() {
  const form = document.getElementById('waitlist-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const email = form.querySelector('input[type="email"]')?.value;
    if (!email) return;
    btn.textContent = '⟳ Enregistrement...';
    btn.disabled = true;
    setTimeout(() => {
      const successEl = document.getElementById('waitlist-success');
      if (successEl) {
        form.style.display = 'none';
        successEl.style.display = 'block';
        const rankEl = successEl.querySelector('.rank-number');
        if (rankEl) animateCount(rankEl, Math.floor(Math.random() * 200 + 800));
      }
    }, 1200);
  });
}
initWaitlistForm();

// ─── CALCULATOR ───
function initCalculator() {
  const calc = document.getElementById('loss-calc');
  if (!calc) return;

  const inputs = {
    visitors: document.getElementById('calc-visitors'),
    searchers: document.getElementById('calc-searchers'),
    panier: document.getElementById('calc-panier'),
  };
  const outputs = {
    visitors: document.getElementById('out-visitors'),
    searchers: document.getElementById('out-searchers'),
    panier: document.getElementById('out-panier'),
    lost: document.getElementById('out-lost'),
    euros: document.getElementById('out-euros'),
    gain: document.getElementById('out-gain'),
    insight: document.getElementById('out-insight'),
  };

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR'); }

  function update() {
    const v = +inputs.visitors.value;
    const s = +inputs.searchers.value / 100;
    const p = +inputs.panier.value;

    if (outputs.visitors) outputs.visitors.textContent = fmt(v);
    if (outputs.searchers) outputs.searchers.textContent = Math.round(s * 100) + '%';
    if (outputs.panier) outputs.panier.textContent = Math.round(p) + ' €';

    const searchers = v * s;
    const failRate = 0.35;
    const lost = Math.round(searchers * failRate);
    const eurosLost = Math.round(lost * 0.045 * p);
    const seekrGain = Math.round(eurosLost * 0.72);

    if (outputs.lost) outputs.lost.textContent = fmt(lost);
    if (outputs.euros) outputs.euros.textContent = fmt(eurosLost) + ' €';
    if (outputs.gain) outputs.gain.textContent = '+' + fmt(seekrGain) + ' €';

    let msg = '';
    if (eurosLost < 500) msg = 'Même à votre échelle, SEEKR récupère son ROI dès le premier mois d\'utilisation.';
    else if (eurosLost < 3000) msg = `${fmt(lost)} chercheurs frustrés par mois — soit ${fmt(eurosLost)} € qui s'évaporent faute d'une recherche intelligente.`;
    else msg = `Chiffres critiques. ${fmt(eurosLost)} € de CA potentiel perdu chaque mois à cause de la Dark Data.`;
    if (outputs.insight) outputs.insight.textContent = msg;

    // Update progress bar
    const maxLoss = 50000;
    const pct = Math.min(eurosLost / maxLoss * 100, 100);
    const bar = document.getElementById('loss-bar');
    if (bar) bar.style.width = pct + '%';
  }

  Object.values(inputs).forEach(input => {
    if (input) input.addEventListener('input', update);
  });
  update();
}
initCalculator();
