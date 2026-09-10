// 焚き火のパチパチ・川の泡など、離散的なワンショットイベントのスケジューラ。
// setTimeout を1イベント1タイマーで使うと分解能とジッタでリズムが濁るため、
// 一定間隔（tick）で起きては ctx.currentTime 基準の少し先（lookahead）までの
// イベントをまとめて予約する「先読み」方式にしている
// （Chris Wilson "A Tale of Two Clocks" と同じ考え方）。
// 全レイヤー共通で 1 本だけ動かし、ジョブ単位で登録・解除する。

/** 指数分布に従う次イベントまでの秒数（ポアソン過程）。rng()===0 でも Infinity にならない。 */
export function poissonDelay(ratePerSec, rng = Math.random) {
  const u = Math.max(rng(), 1e-9);
  return -Math.log(u) / Math.max(ratePerSec, 1e-9);
}

/**
 * getNow: () => 現在時刻（秒）を返す関数。本番では () => ctx.currentTime を渡す。
 * テストでは手動でカウンタを進める関数を渡せる。
 */
export function createScheduler(getNow, { lookahead = 0.25, tick = 80 } = {}) {
  const jobs = new Map();
  let timerId = null;

  /** id: 任意のキー。rate: 1秒あたりの発生回数。onEvent(time): 予約時刻を渡して呼ばれる。 */
  function addJob(id, { rate, onEvent, rng = Math.random }) {
    jobs.set(id, { rate, onEvent, rng, nextTime: getNow() + poissonDelay(rate, rng) });
  }

  function removeJob(id) {
    jobs.delete(id);
  }

  function updateRate(id, rate) {
    const job = jobs.get(id);
    if (job) job.rate = rate;
  }

  /** 先読み窓に入っているイベントをまとめて発火する。外から直接呼んでもよい（テスト用）。 */
  function tickOnce() {
    const horizon = getNow() + lookahead;
    for (const job of jobs.values()) {
      let guard = 0;
      while (job.nextTime < horizon && guard++ < 1000) {
        job.onEvent(job.nextTime);
        job.nextTime += poissonDelay(job.rate, job.rng);
      }
    }
  }

  function start() {
    if (timerId !== null) return;
    timerId = setInterval(tickOnce, tick);
  }

  function stop() {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
    jobs.clear();
  }

  return { addJob, removeJob, updateRate, tickOnce, start, stop };
}
