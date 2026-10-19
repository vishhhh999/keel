// Cost model. Every number here is an assumption, labelled on the page. Edit ASSUME to change the model.
(() => {
  const ASSUME = {
    gpuHourEUR: 0.55,      // rented GPU instance, hourly (assumption, see docs/COSTS.md)
    cpuHourEUR: 0.045,     // CPU-only instance with x264 (assumption)
    storageEUR: 1.2,       // per streamer per month, snapshot + disk
    egressNote: 'Egress is bundled on most low-cost hosts at this scale.',
    fixedEUR: 180,         // control plane, monitoring, email, domain, per month
    supportEURper100: 400, // part-time support per 100 active streamers
    payFeePct: 0.029, payFeeFixed: 0.30,
  };
  const $ = (s) => document.querySelector(s);
  const el = { n: $('#c-n'), h: $('#c-h'), g: $('#c-g'), p: $('#c-p') };
  if (!el.n) return;
  const eur = (v) => '€' + Math.round(v).toLocaleString();
  function run() {
    const n = +el.n.value, h = +el.h.value, gpu = el.g.checked, price = +el.p.value;
    $('#v-n').textContent = n; $('#v-h').textContent = h + ' h'; $('#v-p').textContent = eur(price);
    const hourly = gpu ? ASSUME.gpuHourEUR : ASSUME.cpuHourEUR;
    const compute = n * h * 4.3 * hourly;
    const storage = n * ASSUME.storageEUR;
    const support = (n / 100) * ASSUME.supportEURper100;
    const cost = compute + storage + support + ASSUME.fixedEUR;
    const rev = n * price;
    const fees = n * (price * ASSUME.payFeePct + ASSUME.payFeeFixed);
    const profit = rev - fees - cost;
    $('#o-cost').textContent = eur(cost);
    $('#o-rev').textContent = eur(rev);
    $('#o-gm').textContent = rev > 0 ? Math.round((profit / rev) * 100) + '%' : '0%';
    $('#o-profit').textContent = eur(profit);
    $('#o-per').textContent = eur(n ? cost / n : 0);
    const be = Math.ceil(ASSUME.fixedEUR / Math.max(0.01, price - (h * 4.3 * hourly + ASSUME.storageEUR + ASSUME.supportEURper100 / 100 + price * ASSUME.payFeePct + ASSUME.payFeeFixed)));
    $('#o-be').textContent = isFinite(be) && be > 0 && be < 100000 ? be + ' streamers' : 'not at this price';
  }
  Object.values(el).forEach((e) => e.addEventListener('input', run)); run();
})();
